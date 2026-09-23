import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import {modelTextStream} from './ai.mjs';
import {modelFetch} from './model-transport.mjs';

const complete='data: '+JSON.stringify({choices:[{delta:{content:'完整结果'},finish_reason:'stop'}]})+'\n\n';
async function server(t,handler){
  const server=http.createServer(handler);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close()});
  return 'http://127.0.0.1:'+server.address().port;
}
const config=base=>({enabled:true,provider:'compatible',base,model:'mock',key:'fixture',timeoutSeconds:30});

test('slow headers after successful connection do not consume connect deadline, including reused sockets',async t=>{
  let requests=0;
  const base=await server(t,(req,res)=>{
    requests++;req.resume();
    const timer=setTimeout(()=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(complete)},250);
    res.on('close',()=>clearTimeout(timer));
  });
  for(let i=0;i<2;i++){
    const stages=[];
    const result=await modelTextStream(config(base),[{role:'user',content:'fixture'}],(kind,data)=>{if(kind==='stage')stages.push(data)},{
      connectMs:100,firstResponseMs:2000,idleMs:1000
    });
    assert.equal(result.text,'完整结果');
    assert(stages.some(s=>s.phase==='waiting'));
  }
  assert.equal(requests,2);
});

test('connected socket with no response headers fails as first-response timeout, not connect timeout',async t=>{
  let requests=0;
  const base=await server(t,(req,res)=>{requests++;req.resume()});
  await assert.rejects(modelTextStream(config(base),[],()=>{},{
    connectMs:1000,firstResponseMs:30,idleMs:1000
  }),/首响应等待超时/);
  assert.equal(requests,1); // No automatic retry that could duplicate paid generation.
});

test('user cancellation aborts while waiting for model headers',async t=>{
  const base=await server(t,req=>req.resume()),controller=new AbortController();
  await assert.rejects(modelTextStream(config(base),[],(kind,data)=>{
    if(data.phase==='waiting')controller.abort();
  },{signal:controller.signal}),/已停止/);
});

test('transport preserves compressed model responses and rejects redirects without forwarding credentials',async t=>{
  let redirected=0;
  const base=await server(t,(req,res)=>{
    req.resume();
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/target'});res.end()}
    else if(req.url==='/target'){redirected++;res.end('unexpected')}
    else{res.writeHead(200,{'Content-Type':'text/event-stream','Content-Encoding':'gzip'});res.end(gzipSync(complete))}
  });
  assert.equal((await modelTextStream(config(base),[],()=>{})).text,'完整结果');
  await assert.rejects(modelFetch(base+'/redirect',{headers:{Authorization:'Bearer fixture'}}),/重定向/);
  assert.equal(redirected,0);
});

test('DNS failures are actionable and do not echo address or raw diagnostics',async()=>{
  await assert.rejects(modelTextStream(config('http://fixture.invalid'),[],()=>{},{
    fetcher:async()=>{throw Object.assign(Error('private endpoint detail'),{code:'ENOTFOUND'})}
  }),e=>/DNS 解析失败/.test(e.message)&&!e.message.includes('private'));
});

test('partial output followed by socket reset preserves a safe actionable transport error',async t=>{
  const base=await server(t,(req,res)=>{
    req.resume();res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(1904)}}]})+'\n\n');
    const timer=setTimeout(()=>res.destroy(),30);res.on('close',()=>clearTimeout(timer));
  });
  let count=0;
  await assert.rejects(modelTextStream(config(base),[],(event,data)=>{if(event==='delta')count+=data.text.length}),error=>{
    assert.equal(error.publicError,true);assert.equal(error.retryable,true);
    assert.match(error.message,/1904/);assert.match(error.message,/ECONNRESET|ERR_STREAM_PREMATURE_CLOSE/);return true;
  });
  assert.equal(count,1904);
});
