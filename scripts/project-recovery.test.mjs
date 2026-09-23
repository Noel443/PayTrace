import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {projectJobs} from './project-jobs.mjs';
import {analyzeProject} from './projects.mjs';
import {modelReadError} from './model-errors.mjs';

const answer={summary:'fixture',businesses:['fixture'],chains:[{name:'fixture',steps:[{label:'fixture',service:'fixture',description:'fixture',evidenceIds:['P1']}]}],uncertainties:[]};
const sse=value=>'data: '+JSON.stringify(value)+'\n\n';
async function run(t,mode){
  let requests=0;
  const server=http.createServer(async(req,res)=>{
    for await(const chunk of req){} // fixture only; discard request body
    requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});
    if(mode==='length'){res.end(sse({choices:[{delta:{content:'partial'},finish_reason:'length'}]}));return}
    if(mode==='invalid'){res.end(sse({choices:[{delta:{content:'not json'},finish_reason:'stop'}]}));return}
    if(mode==='recover'&&requests===2){res.end(sse({choices:[{delta:{content:JSON.stringify(answer)},finish_reason:'stop'}]}));return}
    res.write(sse({choices:[{delta:{content:'x'.repeat(1904)}}]}));
    const timer=setTimeout(()=>res.destroy(),25);res.on('close',()=>clearTimeout(timer));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close()});
  let store={version:1,projects:[{id:'fixture',workspace:'card',name:'fixture',revision:1,scanEnabled:false,analysis:{summary:'last success'}}]};
  const jobs=projectJobs({getStore:()=>store,saveStore:async next=>{store=structuredClone(next)},analyze:analyzeProject});
  await jobs.start('fixture','card',{enabled:true,provider:'compatible',base:'http://127.0.0.1:'+server.address().port,model:'mock',key:'fixture'},'# fixture');
  for(let i=0;i<500&&jobs.busy();i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(jobs.busy(),false);
  return {project:store.projects[0],requests};
}
test('project recovers from 1904-character interrupted response by restarting only the incomplete request',async t=>{
  const {project,requests}=await run(t,'recover');
  assert.equal(requests,2);assert.equal(project.task.status,'completed');
  assert.equal(project.analysis.summary,'fixture');
  assert.equal(project.task.stages.filter(s=>s.includes('重新请求当前批次一次')).length,1);
  assert(!JSON.stringify(project.analysis).includes('x'.repeat(50)));
});
test('repeated reset fails with useful code and preserves the last successful result',async t=>{
  const {project,requests}=await run(t,'fail');
  assert.equal(requests,2);assert.equal(project.task.status,'failed');assert.equal(project.analysis.summary,'last success');
  assert.match(project.task.errorCode,/ECONNRESET|ERR_STREAM_PREMATURE_CLOSE/);
  assert.match(project.task.message,/1904/);assert.doesNotMatch(project.task.message,/项目操作失败/);
});
test('length-limited and structurally invalid output do not trigger paid retries',async t=>{
  for(const mode of ['length','invalid']){
    const {project,requests}=await run(t,mode);
    assert.equal(requests,1);assert.equal(project.task.status,'failed');assert.equal(project.analysis.summary,'last success');
  }
});
test('transport diagnostics never return raw errors with sensitive endpoint details',()=>{
  const error=modelReadError(Object.assign(Error('private-key and private-path'),{code:'ECONNRESET'}),1904);
  assert.equal(error.code,'ECONNRESET');assert(!error.message.includes('private'));
  const internal=modelReadError(Object.assign(Error('private state'),{code:'ERR_INVALID_STATE'}),1904);
  assert.equal(internal.retryable,false);assert(!internal.message.includes('private'));
});

test('cancellation at the retry boundary never starts a second model request',async()=>{
  const controller=new AbortController();let requests=0;
  await assert.rejects(analyzeProject({name:'fixture',revision:1,scanEnabled:false},{enabled:true,provider:'compatible',base:'http://fixture',model:'mock',key:'fixture'},'# fixture',(event,data)=>{
    if(data.phase==='retrying')controller.abort();
  },{signal:controller.signal,fetcher:async()=>{
    requests++;
    return new Response(new ReadableStream({start(target){target.error(Object.assign(Error('private'),{code:'ECONNRESET'}))}}),{headers:{'Content-Type':'text/event-stream'}});
  }}));
  assert.equal(requests,1);
});
