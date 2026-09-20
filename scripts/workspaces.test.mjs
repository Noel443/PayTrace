import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){
  const storage=new Map();let fail=false;
  const context=vm.createContext({window:{},structuredClone,localStorage:{getItem:k=>storage.get(k)??null,removeItem:k=>{if(fail)throw Error('quota');storage.delete(k)},setItem:(k,v)=>{if(fail)throw Error('quota');storage.set(k,v)}}});
  const load=()=>{for(const file of ['workspaces','investigation','mock-api'])vm.runInContext(readFileSync(new URL(`../frontend/${file}.js`,import.meta.url),'utf8'),context)};
  load();return {context,storage,load,fail:()=>fail=true,api:(path,method,body,workspace)=>context.window.demoApi(path,method,body,workspace)};
}
test('nine cases retain business-specific statuses, sources and namespace',async()=>{
  const {api}=setup();let count=0;
  for(const workspace of ['card','cross-border','hk-cb']){
    const transactions=await api('/transactions','GET',undefined,workspace);count+=transactions.length;
    for(const tx of transactions){
      const r=await api('/investigations','POST',{transactionId:tx.id},workspace);
      assert.equal(r.workspaceId,workspace);assert.equal(r.transaction.status,tx.status);
      assert(r.evidence.length>0);assert(r.evidence.every(e=>e.matchedBy===tx.id||e.matchedBy==='MSG77662'));
      if(workspace!=='card'){assert(r.sources.length>=2);assert.equal(r.commit.length,40);assert(r.pipeline.length>=4);assert(r.evidence.every(e=>e.text.includes('source=SANDBOX')));}
    }
    assert.equal((await api('/investigations','GET',undefined,workspace)).length,3);
  }
  assert.equal(count,9);
  await assert.rejects(api('/investigations','POST',{transactionId:'HK202609200001'},'cross-border'),/工作空间/);
});
test('service toggles and missing evidence are isolated across projects',async()=>{
  const {api}=setup();
  const services=await api('/services','GET',undefined,'cross-border');
  await api('/services','PUT',services.map(s=>({...s,enabled:false})),'cross-border');
  for(const tx of await api('/transactions','GET',undefined,'cross-border')){
    const report=await api('/investigations','POST',{transactionId:tx.id},'cross-border');
    assert.equal(report.diagnosis,'待核实');assert.equal(report.evidence.length,0);assert.match(report.title,/不足/);
  }
  assert((await api('/services','GET',undefined,'hk-cb')).every(s=>s.enabled));
  assert((await api('/services')).every(s=>s.enabled));
  await assert.rejects(api('/services','PUT',services,'hk-cb'),/配置无效/);
});
test('history, knowledge, feedback and AI results persist in their workspace only',async()=>{
  const {api,load}=setup();
  const r=await api('/investigations','POST',{transactionId:'HK202609200001'},'hk-cb');
  const knowledge=await api('/knowledge','GET',undefined,'hk-cb');
  assert.equal(knowledge.scanEnabled,false);assert.equal(knowledge.projects[0].branch,'master');assert.match(knowledge.markdown,/DEBITING/);
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
  const {api,storage}=setup();
  storage.set('paytrace.frontend.v1.hk-cb.reports',JSON.stringify([{id:'old',workspaceName:'旧名称',transaction:{id:'HK-OLD'}}]));
  storage.set('paytrace.frontend.v1.hk-cb.knowledge',JSON.stringify({markdown:'用户维护的文档',projects:[],scanEnabled:false}));
  assert.equal((await api('/investigations/old','GET',undefined,'hk-cb')).workspaceName,'MSO');
  assert.equal((await api('/knowledge','GET',undefined,'hk-cb')).markdown,'用户维护的文档');
  const report=await api('/investigations','POST',{transactionId:'HK202609200001'},'hk-cb');
  assert.equal(report.workspaceName,'MSO');
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,2);
});
test('storage quota failures do not claim success or change reports, feedback or service configuration',async()=>{
  const {api,fail}=setup();
  const report=await api('/investigations','POST',{transactionId:'HK202609200001'},'hk-cb');
  const services=await api('/services','GET',undefined,'hk-cb');fail();
  await assert.rejects(api('/investigations','POST',{transactionId:'HK202609200002'},'hk-cb'),/未保存/);
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
  assert.match((await api('/knowledge','GET',undefined,w.id)).markdown,/商户结算/);
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
  const {api,load,fail}=setup();
  await api('/knowledge','PUT',{scanEnabled:false,projects:[],markdown:''},'card');
  load();assert.equal((await api('/knowledge')).markdown,'');
  const a=await api('/investigations','POST',{transactionId:'T202609200001'});
  const b=await api('/investigations','POST',{transactionId:'HK202609200001'},'hk-cb');
  await assert.rejects(api('/investigations/'+a.id,'DELETE',undefined,'hk-cb'),/不存在/);
  await api('/investigations/'+a.id,'DELETE');load();
  assert.equal((await api('/investigations')).length,0);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
  await assert.rejects(api('/investigations/'+a.id+'/ai','POST',{status:'completed',text:'late'}),/不存在/);
  fail();await assert.rejects(api('/investigations/'+b.id,'DELETE',undefined,'hk-cb'),/未保存/);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
});

test('bulk report deletion is atomic, validates all IDs and isolates workspaces',async()=>{
  const {api,fail}=setup();
  const a=await api('/investigations','POST',{transactionId:'T202609200001'});
  const b=await api('/investigations','POST',{transactionId:'T202609200002'});
  const other=await api('/investigations','POST',{transactionId:'HK202609200001'},'hk-cb');
  for(const ids of [[],[a.id,a.id],[a.id,'missing'],[a.id,other.id]])await assert.rejects(api('/investigations','DELETE',{ids}));
  assert.equal((await api('/investigations')).length,2);
  await api('/investigations','DELETE',{ids:[a.id,b.id]});assert.equal((await api('/investigations')).length,0);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
  fail();await assert.rejects(api('/investigations','DELETE',{ids:[other.id]},'hk-cb'),/未保存/);
  assert.equal((await api('/investigations','GET',undefined,'hk-cb')).length,1);
});
