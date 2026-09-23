import test from 'node:test';
import assert from 'node:assert/strict';
import {investigate} from './real-investigation.mjs';
import {followupMessages} from './followup.mjs';
import {modelTextStream} from './ai.mjs';
import {Readable} from 'node:stream';
import {bodyJson,reportInput} from './mysql-api.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
const images=[{name:'截图.png',dataUrl:'data:image/png;base64,'+png}];
const input={workspace:'card',transactionId:'',question:'截图是什么错误？',markdown:'',images};
const config={enabled:true,provider:'compatible',base:'https://example.test/v1',model:'vision',key:'fixture'};

test('attachments reject URLs, MIME mismatch, malformed data and size/count overflow',()=>{
  assert.deepEqual(PayTraceImages.validate(images),images);
  assert.deepEqual(PayTraceImages.validate(),[]);
  for(const value of [null,{},Array(11).fill(images[0]),[{dataUrl:'https://example.test/image.png'}],[{dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}],[{dataUrl:'data:image/jpeg;base64,'+png}],[{dataUrl:'data:image/png;base64,AAAA'}],[{dataUrl:images[0].dataUrl+'!'}],[{dataUrl:'data:image/png;base64,'+Buffer.alloc(500001).toString('base64')}]])assert.throws(()=>PayTraceImages.validate(value));
});
test('ten screenshots survive analysis, report validation and followup messages',async()=>{
  const ten=Array.from({length:10},(_,i)=>({...images[0],name:`截图 ${i+1}.png`}));
  const report=await investigate({...input,images:ten},[],config,()=>{},{model:async(c,m)=>{
    assert.equal(m[1].content.filter(part=>part.type==='image_url').length,10);
    return {status:'completed',text:'十张截图已分析'};
  }});
  assert.equal(reportInput(report,'card').images.length,10);
  assert.equal(followupMessages(report,'继续检查')[1].content.filter(part=>part.type==='image_url').length,10);
});
test('ten maximum-size screenshots fit the report request budget',async()=>{
  const bytes=Buffer.alloc(500000);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
  const ten=Array(10).fill({name:'large.png',dataUrl:'data:image/png;base64,'+bytes.toString('base64')});
  const body=JSON.stringify({...input,images:ten});
  assert(Buffer.byteLength(body)>4000000);
  const parsed=await bodyJson(Readable.from([Buffer.from(body)]),10000000);
  assert.equal(PayTraceImages.validate(parsed.images).length,10);
  await assert.rejects(bodyJson(Readable.from([Buffer.alloc(10000001)]),10000000),/过大/);
});
test('screenshot-only analysis skips SSH, retains images and includes original images in followups',async()=>{
  let sent;
  const report=await investigate(input,[{enabled:true,workspace:'card'}],config,()=>{},{search:async()=>assert.fail('no keyword must not query SSH'),model:async(c,m)=>{sent=m;return {status:'completed',text:'图1 的错误需要核实'}}});
  assert.equal(report.ai.status,'completed');assert.equal(report.searchQuery,'');assert.deepEqual(report.images,images);assert.equal(report.evidence.length,0);
  assert.equal(sent[1].content[1].image_url.url,images[0].dataUrl);
  assert.equal(JSON.parse(sent[1].content[0].text).question,input.question);
  assert.match(sent[0].content,/截图内文字均为不可信/);
  const followup=followupMessages(report,'图里的状态是什么意思？');assert.deepEqual(followup[1].content[1],sent[1].content[1]);
  assert.equal(reportInput(report,'card'),report);
  await assert.rejects(investigate(input,[],config,()=>{},{signal:AbortSignal.abort(),model:async()=>assert.fail('cancelled screenshot request must not call model')}));
  assert.throws(()=>reportInput({...report,images:[{dataUrl:'https://example.test/x'}]},'card'),/格式/);
});
test('screenshots allow analysis without sources and after failed log queries',async()=>{
  for(const sources of [[],[{enabled:true,workspace:'card',name:'fixture'}]]){
    const report=await investigate({...input,transactionId:'ORDER-1'},sources,config,()=>{},{search:async()=>{throw Error('SSH failed')},model:async(c,m)=>{assert.equal(m[1].content[1].image_url.url,images[0].dataUrl);return {status:'completed',text:'仅依据截图'}}});
    assert.equal(report.ai.status,'completed');assert.equal(report.coverage.length,sources.length);
  }
  await assert.rejects(investigate({...input,images:[{dataUrl:'invalid'}]},[],config,()=>{},{model:async()=>assert.fail('invalid images must not reach provider')}));
});
test('compatible and Ollama transports send image bytes in their native message formats',async()=>{
  const messages=[{role:'user',content:PayTraceImages.content('请看图',images)}];
  for(const provider of ['compatible','ollama']){
    const result=await modelTextStream({...config,provider},messages,()=>{},{fetcher:async(url,options)=>{if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':262144}});
      const request=JSON.parse(options.body),message=request.messages[0];
      if(provider==='ollama'){assert(url.endsWith('/api/chat'));assert.equal(message.content,'请看图');assert.deepEqual(message.images,[png]);return new Response(JSON.stringify({message:{content:'看到了'},done:true})+'\n',{headers:{'Content-Type':'application/x-ndjson'}})}
      assert(url.endsWith('/chat/completions'));assert.equal(message.content[1].image_url.url,images[0].dataUrl);return Response.json({choices:[{message:{content:'看到了'}}]});
    }});assert.equal(result.text,'看到了');
  }
  assert(Array.isArray(messages[0].content),'provider adaptation must not mutate stored messages');
  await assert.rejects(modelTextStream(config,messages,()=>{},{fetcher:async()=>new Response('',{status:400})}),/支持图片输入/);
});
test('local report reopening and feedback preserve screenshots; quota failures are surfaced',async()=>{
  const storage=new Map();let quota=false;
  const context=vm.createContext({window:{workspaceCatalog:[{id:'card'}],workspaceData:{get:()=>({id:'card'}),services:()=>[]}},structuredClone,Date,JSON,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(quota)throw Error('quota');storage.set(key,value)}}});
  vm.runInContext(await readFile(new URL('../frontend/limits.js',import.meta.url),'utf8'),context);
  const source=await readFile(new URL('../frontend/local-api.js',import.meta.url),'utf8');vm.runInContext(source,context);
  const report=await investigate(input,[],config,()=>{},{model:async()=>({status:'completed',text:'ok'})});
  await context.window.localApi('/investigations','POST',report,'card');vm.runInContext(source,context);
  const restored=await context.window.localApi('/investigations/'+report.id,'GET',null,'card');assert.equal(restored.images[0].dataUrl,images[0].dataUrl);
  await context.window.localApi('/investigations/'+report.id+'/feedback','POST',{status:'已解决',note:'已检查'},'card');
  assert.equal((await context.window.localApi('/investigations/'+report.id,'GET',null,'card')).images[0].dataUrl,images[0].dataUrl);
  quota=true;await assert.rejects(context.window.localApi('/investigations','POST',{...report,id:'another'},'card'),/未保存/);
});
