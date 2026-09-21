import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){
  const storage=new Map();let fail=false;
  const context=vm.createContext({window:{},structuredClone,localStorage:{getItem:k=>storage.get(k)??null,removeItem:k=>{if(fail)throw Error('quota');storage.delete(k)},setItem:(k,v)=>{if(fail)throw Error('quota');storage.set(k,v)}}});
  const load=()=>{for(const file of ['workspaces','local-api'])vm.runInContext(readFileSync(new URL(`../frontend/${file}.js`,import.meta.url),'utf8'),context)};
  const seed=(id,workspace='card')=>{const key='paytrace.frontend.v1.'+(workspace==='card'?'':workspace+'.')+'reports';const report={id,transaction:{id:'REAL-'+id},feedback:{},ai:{status:'disabled'}};storage.set(key,JSON.stringify([report,...JSON.parse(storage.get(key)||'[]')]));return report;};
  load();return {context,storage,load,seed,fail:()=>fail=true,api:(path,method,body,workspace)=>context.window.localApi(path,method,body,workspace)};
}
test('all workspaces start empty and cannot generate synthetic reports',async()=>{
  const {api,context}=setup();
  for(const workspace of ['card','cross-border','hk-cb']){
    for(const path of ['/transactions','/services','/investigations'])assert.equal((await api(path,'GET',undefined,workspace)).length,0);
    assert.equal((await api('/knowledge','GET',undefined,workspace)).markdown,'');
    assert.equal(context.window.workspaceData.get(workspace).cases.length,0);
    await assert.rejects(api('/investigations','POST',{transactionId:'T202609200001'},workspace),/尚未接入/);
  }
});
test('reload removes demo history while retaining real records, documents and workspace metadata',async()=>{
  const {api,storage,load,context}=setup();
  context.window.workspaceData.update('card',{name:'我的外卡',description:'实际业务'});
  for(const [workspace,id] of [['card','T202609200001'],['cross-border','CB202609200002'],['hk-cb','HK202609200003']]){
    const prefix='paytrace.frontend.v1.'+(workspace==='card'?'':workspace+'.');
    storage.set(prefix+'reports',JSON.stringify([{id:'demo',transaction:{id}},{id:'old-demo',mode:'规则诊断 · 沙箱数据'},{id:'real',transaction:{id:'REAL-1'}}]));
    storage.set(prefix+'knowledge',JSON.stringify({scanEnabled:false,projects:[],markdown:'已保存文档'}));
  }
  load();load();
  assert.equal(context.window.workspaceData.get('card').name,'我的外卡');
  for(const workspace of ['card','cross-border','hk-cb']){
    const rows=await api('/investigations','GET',undefined,workspace);
    assert.equal(rows.length,1);assert.equal(rows[0].id,'real');
    assert.equal((await api('/knowledge','GET',undefined,workspace)).markdown,'已保存文档');
    await assert.rejects(api('/investigations/demo','GET',undefined,workspace),/不存在/);
    const key='paytrace.frontend.v1.'+(workspace==='card'?'':workspace+'.')+'reports';
    assert.equal(JSON.parse(storage.get(key)).length,1);
  }
});
test('demo history remains hidden if browser cleanup cannot persist',async()=>{
  const {api,storage,fail,load}=setup();
  storage.set('paytrace.frontend.v1.reports',JSON.stringify([{id:'demo',transaction:{id:'T202609200001'}}]));
  fail();load();assert.equal((await api('/investigations')).length,0);
});
test('history, knowledge, feedback and AI results persist in their workspace only',async()=>{
  const {api,load,seed}=setup();
  const r=seed('HK1','hk-cb');
  const knowledge=await api('/knowledge','GET',undefined,'hk-cb');
  assert.equal(knowledge.scanEnabled,false);assert.equal(knowledge.projects.length,0);assert.equal(knowledge.markdown,'');
  await api('/knowledge','PUT',{...knowledge,markdown:'# MSO知识'},'hk-cb');
  assert.notEqual((await api('/knowledge','GET',undefined,'cross-border')).markdown,'# MSO知识');
  await api(`/investigations/${r.id}/feedback`,'POST',{status:'需要开发介入',note:'跟进明细'},'hk-cb');
  await api(`/investigations/${r.id}/ai`,'POST',{status:'completed',text:'待核实明细',revision:0},'hk-cb');
  await assert.rejects(api(`/investigations/${r.id}`,'GET',undefined,'card'),/不存在/);
  load();
  const reloaded=await api(`/investigations/${r.id}`,'GET',undefined,'hk-cb');
  assert.equal(reloaded.ai.text,'待核实明细');assert.equal(reloaded.feedback.status,'需要开发介入');
  assert.equal((await api('/knowledge','GET',undefined,'hk-cb')).markdown,'# MSO知识');
});
test('legacy card history remains readable without migration',async()=>{
  const {api,storage,load}=setup();storage.set('paytrace.frontend.v1.reports',JSON.stringify([{id:'legacy',transaction:{id:'T-OLD'}}]));
  load();assert.equal((await api('/investigations'))[0].id,'legacy');
  assert.equal((await api('/investigations','GET',undefined,'cross-border')).length,0);
});
test('MSO naming preserves legacy workspace keys and custom business documents',async()=>{
  const {api,storage,seed}=setup();
  storage.set('paytrace.frontend.v1.hk-cb.reports',JSON.stringify([{id:'old',workspaceName:'旧名称',transaction:{id:'HK-OLD'}}]));
  storage.set('paytrace.frontend.v1.hk-cb.knowledge',JSON.stringify({markdown:'用户维护的文档',projects:[],scanEnabled:false}));
  assert.equal((await api('/investigations/old','GET',undefined,'hk-cb')).workspaceName,'MSO');
  assert.equal((await api('/knowledge','GET',undefined,'hk-cb')).markdown,'用户维护的文档');
  const report=seed('HK1','hk-cb');
  assert.equal((await api('/investigations/'+report.id,'GET',undefined,'hk-cb')).workspaceName,'MSO');
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,2);
});
test('storage quota failures do not claim success or change reports, feedback or service configuration',async()=>{
  const {api,fail,seed}=setup();
  const report=seed('HK1','hk-cb');
  const services=await api('/services','GET',undefined,'hk-cb');fail();
  await assert.rejects(api('/knowledge','PUT',{scanEnabled:false,projects:[],markdown:'未保存'},'hk-cb'),/未保存/);
  await assert.rejects(api('/services','PUT',services.map(s=>({...s,enabled:false})),'hk-cb'),/未保存/);
  await assert.rejects(api(`/investigations/${report.id}/feedback`,'POST',{status:'已解决'},'hk-cb'),/未保存/);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
  assert.equal((await api(`/investigations/${report.id}`,'GET',undefined,'hk-cb')).feedback.status,undefined);
  assert((await api('/services','GET',undefined,'hk-cb')).every(s=>s.enabled));
});

test('custom workspace creation persists, stays isolated and never copies built-in scenarios',async()=>{
  const {api,context,load,fail}=setup();
  const w=context.window.workspaceData.create({name:'商户结算',description:'结算业务',businesses:'结算,分账'});
  assert.equal(w.custom,true);assert.equal((await api('/transactions','GET',undefined,w.id)).length,0);
  assert.equal((await api('/services','GET',undefined,w.id)).length,0);
  assert.equal((await api('/knowledge','GET',undefined,w.id)).markdown,'');
  const knowledge=await api('/knowledge','GET',undefined,w.id);
  await api('/knowledge','PUT',{...knowledge,markdown:'# 独立文档'},w.id);
  load();assert.equal(context.window.workspaceData.get(w.id).name,'商户结算');
  assert.equal((await api('/knowledge','GET',undefined,w.id)).markdown,'# 独立文档');
  assert.notEqual((await api('/knowledge')).markdown,'# 独立文档');
  assert.throws(()=>context.window.workspaceData.create({name:'商户结算'}),/已存在/);
  const count=context.window.workspaceCatalog.length;fail();
  assert.throws(()=>context.window.workspaceData.create({name:'保存失败空间'}),/未保存/);
  assert.equal(context.window.workspaceCatalog.length,count);
});

test('workspace rename and deletion persist for built-in and custom spaces without crossing namespaces',async()=>{
  const {api,context,storage,load}=setup();
  const w=context.window.workspaceData.create({name:'删除测试'});
  context.window.workspaceData.update(w.id,{name:'修改后',businesses:'付款、结算'});
  context.window.workspaceData.update('card',{name:'外卡新名称',description:'说明'});
  await api('/knowledge','PUT',{scanEnabled:false,projects:[],markdown:'保留'},'hk-cb');
  await api('/knowledge','PUT',{scanEnabled:false,projects:[],markdown:'删除'},w.id);
  load();assert.equal(context.window.workspaceData.get(w.id).name,'修改后');
  assert.equal(context.window.workspaceData.get('card').name,'外卡新名称');
  assert.throws(()=>context.window.workspaceData.update(w.id,{name:'外卡新名称'}),/已存在/);
  context.window.workspaceData.remove(w.id);context.window.workspaceData.remove('card');
  assert(!storage.has('paytrace.frontend.v1.'+w.id+'.knowledge'));
  load();assert.throws(()=>context.window.workspaceData.get(w.id),/不存在/);
  assert.throws(()=>context.window.workspaceData.get('card'),/不存在/);
  assert.equal((await api('/knowledge','GET',undefined,'hk-cb')).markdown,'保留');
  context.window.workspaceData.remove('cross-border');
  assert.throws(()=>context.window.workspaceData.remove('hk-cb'),/至少保留/);
});
test('failed workspace edits and deletes keep the catalog and data',async()=>{
  const {context,fail,load}=setup();fail();
  assert.throws(()=>context.window.workspaceData.update('card',{name:'失败'}),/未保存/);
  assert.throws(()=>context.window.workspaceData.remove('card'),/未完成/);
  assert.equal(context.window.workspaceCatalog.length,3);load();assert.equal(context.window.workspaceData.get('card').name,'外卡支付');
});
test('explicitly empty knowledge stays empty after reload and reports delete only in their own space',async()=>{
  const {api,load,fail,seed}=setup();
  await api('/knowledge','PUT',{scanEnabled:false,projects:[],markdown:''},'card');
  load();assert.equal((await api('/knowledge')).markdown,'');
  const a=seed('T1');
  const b=seed('HK1','hk-cb');
  await assert.rejects(api('/investigations/'+a.id,'DELETE',undefined,'hk-cb'),/不存在/);
  await api('/investigations/'+a.id,'DELETE');load();
  assert.equal((await api('/investigations')).length,0);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
  await assert.rejects(api('/investigations/'+a.id+'/ai','POST',{status:'completed',text:'late'}),/不存在/);
  fail();await assert.rejects(api('/investigations/'+b.id,'DELETE',undefined,'hk-cb'),/未保存/);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
});

test('bulk report deletion is atomic, validates all IDs and isolates workspaces',async()=>{
  const {api,fail,seed}=setup();
  const a=seed('T1');
  const b=seed('T2');
  const other=seed('HK1','hk-cb');
  for(const ids of [[],[a.id,a.id],[a.id,'missing'],[a.id,other.id]])await assert.rejects(api('/investigations','DELETE',{ids}));
  assert.equal((await api('/investigations')).length,2);
  await api('/investigations','DELETE',{ids:[a.id,b.id]});assert.equal((await api('/investigations')).length,0);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
  fail();await assert.rejects(api('/investigations','DELETE',{ids:[other.id]},'hk-cb'),/未保存/);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
});
