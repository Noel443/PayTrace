import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {followup,followupMessages} from './followup.mjs';
import {mysqlApi} from './mysql-api.mjs';
const report=()=>({id:'report-1',kind:'real',workspaceId:'card',transaction:{id:'ORDER-1'},question:'为什么失败',evidence:[{id:'E1',text:'ORDER-1 timeout'}],coverage:[{truncated:true}],ai:{status:'failed',text:'模型错误'},revision:0,feedback:{status:'已解决',note:'保留'}});
const images=[{name:'追问.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII='}];
const turn=(id='turn-1')=>({id,question:'哪里超时',text:'请求超时 [E1]，最终状态待核实',model:'fixture',createdAt:new Date().toISOString()});
test('followups use evidence, initial successful answer and ordered conversation, never failed answer',async()=>{
  const r=report();r.followups=[turn()];
  const messages=followupMessages(r,'下一步呢','业务文档');
  assert.ok(messages[1].content.includes('ORDER-1 timeout'));assert.ok(messages[1].content.includes('业务文档'));
  assert.deepEqual(messages.slice(-3).map(m=>m.role),['user','assistant','user']);
  assert.equal(messages.at(-1).content,'下一步呢');assert.ok(!JSON.stringify(messages).includes('模型错误'));
  r.ai={status:'completed',text:'原始分析'};assert.equal(followupMessages(r,'继续')[2].content,'原始分析');
  const result=await followup({enabled:true},r,'  继续  ','',()=>{},{model:async(c,m)=>({text:'新回答',model:'fixture'})});
  assert.equal(result.question,'继续');assert.equal(result.text,'新回答');assert.equal(r.followups.length,1);
});
test('context keeps whole recent turns, bounded by count and characters; original history remains',()=>{
  const r=report();r.followups=Array.from({length:20},(_,i)=>({...turn('t'+i),question:'q'+i}));
  assert.equal(PayTraceFollowup.context(r).omitted,8);assert.equal(PayTraceFollowup.context(r).turns[0].question,'q8');
  r.followups.at(-1).text='x'.repeat(30000);r.followups.at(-2).text='x'.repeat(30000);
  assert.equal(PayTraceFollowup.context(r).turns.length,1);assert.equal(r.followups.length,20);
});
test('invalid input, missing model, failure and cancellation do not alter conversation',async()=>{
  const r=report(),before=structuredClone(r);let called=false;
  const options={model:async()=>{called=true;throw Error('provider failed')}};
  await assert.rejects(followup({enabled:true},r,'','',()=>{},options),/请输入/);assert.equal(called,false);
  await assert.rejects(followup({enabled:false},r,'继续','',()=>{},options),/启用/);
  await assert.rejects(followup({enabled:true},r,'继续','',()=>{},{...options,signal:AbortSignal.abort()}));assert.equal(called,false);
  await assert.rejects(followup({enabled:true},r,'继续','',()=>{},options),/provider failed/);assert.deepEqual(r,before);
});
test('append is idempotent, detects stale history and evidence, preserves feedback',()=>{
  const r=report(),update={turn:turn(),expectedCount:0,revision:0};
  PayTraceFollowup.append(r,update);PayTraceFollowup.append(r,update);assert.equal(r.followups.length,1);assert.equal(r.feedback.note,'保留');
  assert.throws(()=>PayTraceFollowup.append(r,{...update,turn:turn('another')}),/对话已更新/);
  assert.throws(()=>PayTraceFollowup.append(r,{...update,revision:1}),/证据已更新/);
  assert.throws(()=>PayTraceFollowup.append(r,{...update,turn:{...turn(),text:'changed'}}),/冲突/);
});
test('browser persistence survives reopening, isolates workspaces, exposes quota failures',async()=>{
  const storage=new Map();let quota=false;
  const c=vm.createContext({atob,btoa,window:{workspaceCatalog:[],workspaceData:{get(){},services(){return []}}},structuredClone,localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(quota)throw Error('quota');storage.set(k,v)}}});
  for(const f of ['images','followup-data','local-api'])vm.runInContext(await readFile(new URL('../frontend/'+f+'.js',import.meta.url),'utf8'),c);
  const api=c.window.localApi;await api('/investigations','POST',report(),'card');
  const update={turn:{...turn(),images,logQuery:{evidence:[{id:'QE1',text:'sample exception'}],coverage:[]}},expectedCount:0,revision:0};await api('/investigations/report-1/followups','POST',update,'card');
  assert.equal((await api('/investigations/report-1','GET',null,'card')).followups.length,1);assert.equal((await api('/investigations/report-1','GET',null,'card')).followups[0].logQuery.evidence[0].text,'sample exception');
  assert.equal((await api('/investigations/report-1','GET',null,'card')).followups[0].images[0].dataUrl,images[0].dataUrl);
  await assert.rejects(api('/investigations/report-1/followups','POST',update,'hk-cb'),/不存在/);
  quota=true;await assert.rejects(api('/investigations/report-1/followups','POST',{...update,expectedCount:1,turn:turn('t2')},'card'),/未保存/);
  assert.equal((await api('/investigations/report-1','GET',null,'card')).followups.length,1);assert.equal((await api('/investigations/report-1','GET',null,'card')).followups[0].logQuery.evidence[0].text,'sample exception');
});
test('MySQL adapter appends to JSON without overwriting feedback or crossing workspaces',async()=>{
  let stored=report();
  const api=mysqlApi({transaction:fn=>fn({execute:async(sql,args)=>{
    if(sql.startsWith('SELECT id FROM'))return [[{id:'card'}]];
    if(sql.startsWith('SELECT payload'))return [args[0]==='card'?[{payload:JSON.stringify(stored)}]:[]];
    if(sql.startsWith('UPDATE investigations')){stored=JSON.parse(args[0]);return [{affectedRows:1}]}
    assert.fail(sql);
  }})});
  const update={turn:{...turn(),images,logQuery:{evidence:[{id:'QE1',text:'sample exception'}],coverage:[]}},expectedCount:0,revision:0},path='/api/data/investigations/report-1/followups';
  await api.handle(path,'POST',update,'card');await api.handle(path,'POST',update,'card');
  assert.deepEqual(stored.followups[0].images,images);assert.equal(stored.followups.length,1);assert.equal(stored.followups[0].logQuery.evidence[0].text,'sample exception');assert.equal(stored.feedback.note,'保留');
  await assert.rejects(api.handle(path,'POST',{...update,turn:turn('t2')},'card'),/对话已更新/);
  await assert.rejects(api.handle(path,'POST',update,'hk-cb'),/不存在/);
});

test('expand followup re-queries workspace sources and persists separately cited evidence',async()=>{
 const r=report(),calls=[];
 const result=await followup({enabled:true},r,'查查附近日志，扩大范围','',()=>{},{sources:[{workspace:'card',enabled:true,name:'fixture',logPath:'trx.log'},{workspace:'other',enabled:true,name:'excluded'}],search:async(s,o)=>{calls.push([s.name,o.contextLines]);return {output:'1:ORDER-1 request\n2-java.lang.RuntimeException: sample error',contextLines:o.contextLines}},model:async(c,m)=>{assert.match(m[1].content,/sample error/);assert.match(m[1].content,/latestLogQuery/);return {text:'发现候选异常'}}});
 assert.deepEqual(calls,[['fixture',0],['fixture',100]]);
 assert.match(result.logQuery.evidence[0].id,/^Q.*E1$/);
 PayTraceFollowup.append(r,{turn:result,expectedCount:0,revision:0});
 assert.equal(r.followups[0].logQuery.evidence.length,1);
 assert.match(followupMessages(r,'解释下这个错误')[1].content,/sample error/);
 assert.equal(r.evidence[0].text,'ORDER-1 timeout');
});


test('new screenshots reach the model, persist and remain in later turns, including image-only questions',async()=>{
  const r={...report(),images};
  for(const question of ['请看这张新图','']){
    const result=await followup({enabled:true},r,question,'',()=>{},{images,model:async(c,m)=>{
      assert.equal(m[1].content[1].image_url.url,images[0].dataUrl);
      assert.equal(m.at(-1).content[1].image_url.url,images[0].dataUrl);
      assert.ok(m.at(-1).content[0].text);
      return {text:'分析新截图',model:'fixture'};
    }});
    PayTraceFollowup.append(r,{turn:result,expectedCount:(r.followups||[]).length,revision:0});
    assert.deepEqual(r.followups.at(-1).images,images);
  }
  const messages=followupMessages(r,'对比这几张图');
  assert.equal(messages.filter(m=>Array.isArray(m.content)).length,3);
  const update={turn:r.followups[0],expectedCount:2,revision:0};
  PayTraceFollowup.append(r,update);
  assert.throws(()=>PayTraceFollowup.append(r,{...update,turn:{...update.turn,images:[]}}),/冲突/);
});

test('image history is bounded by whole turns without changing saved attachments',()=>{
  const r=report();r.followups=[{...turn('old'),images},{...turn('recent'),images:Array(10).fill(images[0])}];
  const history=PayTraceFollowup.context(r);
  assert.equal(history.omitted,1);assert.equal(history.turns.length,1);assert.equal(history.turns[0].images.length,10);
  assert.equal(r.followups.length,2);assert.deepEqual(r.followups[0].images,images);
});

test('invalid followup attachments are rejected before model, log query or persistence',async()=>{
  for(const invalid of [[{dataUrl:'https://example.test/image.png'}],Array(11).fill(images[0]),null]){
    await assert.rejects(followup({enabled:true},report(),'补查日志','',()=>{},{images:invalid,model:()=>assert.fail('model must not run'),search:()=>assert.fail('search must not run')}));
    assert.throws(()=>PayTraceFollowup.append(report(),{turn:{...turn(),images:invalid},expectedCount:0,revision:0}));
  }
});
