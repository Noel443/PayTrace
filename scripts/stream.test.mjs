import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeStream,config} from './ai.mjs';
const input={report:{transaction:{id:'T1'},evidence:[{id:'E1',text:'event=CHANNEL_TIMEOUT',context:'OTHER TRANSACTION'}]},markdown:'# 知识'};
const compatible=config({AI_MODEL:'analysis-model',AI_BASE_URL:'https://example.test/v1',AI_API_KEY:'test-secret'});
function response(text,type='text/event-stream',size=1){
  const bytes=new TextEncoder().encode(text);let index=0;
  return new Response(new ReadableStream({pull(controller){if(index>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(index,index+=size));}}),{headers:{'Content-Type':type}});
}
const event=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
test('SSE handles split UTF-8, CRLF, comments and multiline data',async()=>{
  const events=[];
  await PayTraceStream.readEvents(response(': heartbeat\r\nevent: delta\r\ndata: 中文\r\ndata: [E1]\r\n\r\ndata: tail'),'sse',item=>events.push(item));
  assert.deepEqual(events,[{event:'delta',data:'中文\n[E1]'},{event:'message',data:'tail'}]);
});
test('compatible stream exposes only answer deltas, completes and excludes unrelated context',async()=>{
  const events=[];
  const body=event({choices:[{delta:{reasoning_content:'private thinking'}}]})+event({choices:[{delta:{content:'## 已确认事实\n'}}]})+event({choices:[{delta:{content:'超时 [E1]。'},finish_reason:'stop'}]});
  const result=await analyzeStream(compatible,input,(kind,data)=>events.push({kind,data}),{fetcher:async(url,options)=>{if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':262144}});
    const request=JSON.parse(options.body);assert.equal(request.stream,true);assert.equal(options.headers.Authorization,'Bearer test-secret');assert(!request.messages[1].content.includes('OTHER TRANSACTION'));
    return response(body);
  }});
  assert.equal(result.text,'## 已确认事实\n超时 [E1]。');assert.equal(result.status,'completed');
  assert(!JSON.stringify(events).includes('private thinking'));assert(!JSON.stringify(events).includes('test-secret'));
  assert.deepEqual(events.filter(e=>e.kind==='delta').map(e=>e.data.text),['## 已确认事实\n','超时 [E1]。']);
});
test('Ollama handles NDJSON split across bytes and only saves after done',async()=>{
  const c=config({AI_PROVIDER:'ollama',AI_MODEL:'qwen3:8b'});
  const body=JSON.stringify({message:{content:'事实 [E1]'},done:false})+'\n'+JSON.stringify({message:{content:'待核实'},done:true});
  const result=await analyzeStream(c,input,()=>{},{fetcher:async(url,options)=>{if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':262144}});assert(url.endsWith('/api/chat'));assert.equal(options.headers.Authorization,undefined);return response(body,'application/x-ndjson')}});
  assert.equal(result.text,'事实 [E1]待核实');
});
test('truncated, malformed, refused and length-limited streams cannot become completed reports',async()=>{
  for(const body of [event({choices:[{delta:{content:'partial'}}]}),'data: broken\n\n',event({error:{message:'secret upstream error'}}),event({choices:[{delta:{content:'partial'},finish_reason:'length'}]}),event({choices:[{delta:{},finish_reason:'content_filter'}]}),'data: [DONE]\n\n']){
    await assert.rejects(analyzeStream(compatible,input,()=>{},{fetcher:async()=>response(body)}),error=>!error.message.includes('secret upstream error'));
  }
});
test('JSON fallback is explicitly reported and never given an artificial stream',async()=>{
  const events=[];
  const result=await analyzeStream(compatible,input,(kind,data)=>events.push({kind,data}),{fetcher:async()=>response(JSON.stringify({choices:[{message:{content:'整段分析'}}]}),'application/json')});
  assert.equal(result.text,'整段分析');assert(events.some(e=>e.data.message?.includes('完整响应')));assert.equal(events.filter(e=>e.kind==='delta').length,1);
});
test('provider errors explain the cause without exposing upstream details across response formats',async()=>{
  for(const [code,expected] of [['context_length_exceeded',/上下文上限/],['insufficient_quota',/额度/],['invalid_api_key',/认证/],['model_not_found',/模型不存在/],['unsupported_parameter',/请求参数/],['server_error',/内部错误/],['unknown',/未提供可识别/]]){
    const payload={error:{code,message:'private upstream detail test-secret'}};
    for(const [c,body,type] of [[compatible,event(payload),'text/event-stream'],[compatible,JSON.stringify(payload),'application/json'],[config({AI_PROVIDER:'ollama',AI_MODEL:'local'}),JSON.stringify(payload)+'\n','application/x-ndjson']]){
      await assert.rejects(analyzeStream(c,input,()=>{},{fetcher:async url=>url.endsWith('/api/show')?Response.json({model_info:{'mock.context_length':262144}}):response(body,type)}),error=>{
        assert.match(error.message,expected);assert(!error.message.includes('private upstream'));assert(!error.message.includes('test-secret'));return true;
      });
    }
  }
});
test('abort cancels upstream and does not complete',async()=>{
  const controller=new AbortController();
  const promise=analyzeStream(compatible,input,()=>{},{signal:controller.signal,fetcher:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});
  controller.abort();await assert.rejects(promise,/已停止/);
});

test('connection deadline is separate from provider total deadline',async()=>{
  await assert.rejects(analyzeStream(compatible,input,()=>{},{connectMs:10,fetcher:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}),/连接等待超时/);
});

test('non-streaming analysis gets five minutes while connection tests can keep one minute',async t=>{
  const {analyze}=await import('./ai.mjs');const durations=[];
  t.mock.method(AbortSignal,'timeout',ms=>{durations.push(ms);return new AbortController().signal});
  const fetcher=async()=>Response.json({choices:[{message:{content:'有效结果'}}]});
  await analyze(compatible,input,fetcher);
  await analyze(compatible,input,fetcher,{timeoutMs:60000});
  assert.deepEqual(durations,[300000,60000]);
});

test('streaming analysis enforces the provider-specific saved timeout',async t=>{
  let duration;const stages=[];
  t.mock.method(AbortSignal,'timeout',ms=>{duration=ms;return new AbortController().signal});
  const result=await analyzeStream({...compatible,timeoutSeconds:900},input,(kind,data)=>stages.push(data),{fetcher:async()=>response(event({choices:[{delta:{content:'结果'},finish_reason:'stop'}]}))});
  assert.equal(result.status,'completed');
  assert.ok(stages.some(s=>s.message?.includes('900 秒')));
});

test('reasoning and heartbeat bytes reset idle wait without leaking thinking',async()=>{
  const {modelTextStream}=await import('./ai.mjs');let timer;const output=[];
  const result=await modelTextStream(compatible,[{role:'user',content:'question'}],(kind,data)=>output.push({kind,data}),{idleMs:60,fetcher:async()=>new Response(new ReadableStream({
    start(controller){let n=0;timer=setInterval(()=>{if(n++<5)controller.enqueue(new TextEncoder().encode(n%2?': heartbeat\n\n':event({choices:[{delta:{reasoning_content:'PRIVATE'}}]})));else{clearInterval(timer);controller.enqueue(new TextEncoder().encode(event({choices:[{delta:{content:'answer'},finish_reason:'stop'}]})));controller.close()}},20)},
    cancel(){clearInterval(timer)}
  }),{headers:{'Content-Type':'text/event-stream'}})});
  assert.equal(result.text,'answer');assert(!JSON.stringify(output).includes('PRIVATE'));
});
test('idle response fails explicitly, and HTTP context errors do not leak provider text',async()=>{
  const {modelTextStream}=await import('./ai.mjs');
  await assert.rejects(modelTextStream(compatible,[],()=>{},{idleMs:10,fetcher:async()=>new Response(new ReadableStream({start(){},cancel(){}}))}),/无数据等待超时/);
  await assert.rejects(modelTextStream(compatible,[],()=>{},{fetcher:async()=>Response.json({error:{code:'context_length_exceeded',message:'private'}},{status:400})}),e=>/上下文上限/.test(e.message)&&!e.message.includes('private'));
});

test('Ollama checks native context before sending text and uses an explicit context allocation',async()=>{
  const {modelTextStream}=await import('./ai.mjs');
  let chat=false;
  await assert.rejects(modelTextStream({enabled:true,provider:'ollama',model:'small',base:'http://mock'},[{role:'user',content:'x'.repeat(20000)}],()=>{},{fetcher:async url=>{
    if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':8192}});
    chat=true;assert.fail('must not send oversized prompt');
  }}),/上下文容量不足/);
  assert.equal(chat,false);
});

test('continuous upstream activity cannot extend the total request deadline',async t=>{
  const {modelTextStream}=await import('./ai.mjs'),original=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>original(fn,ms===300000?40:ms,...args));
  let heartbeat;
  await assert.rejects(modelTextStream(compatible,[],()=>{},{fetcher:async()=>new Response(new ReadableStream({
    start(controller){heartbeat=setInterval(()=>controller.enqueue(new TextEncoder().encode(': activity\n\n')),5)},
    cancel(){clearInterval(heartbeat)}
  }))}),/总时限/);
});
