import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){
  const storage=new Map(),ctx=vm.createContext({window:{},structuredClone,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
  for(const file of ['limits','workspaces','investigation','mock-api','evidence-graph'])vm.runInContext(readFileSync(new URL('../'+(['workspaces','mock-api'].includes(file)?'scripts/fixtures':'frontend')+'/'+file+'.js',import.meta.url),'utf8'),ctx);
  return {api:ctx.window.demoApi,graph:ctx.PayTraceGraph};
}
test('all nine cases map every exact evidence once and preserve unknown pipeline nodes',async()=>{
  const {api,graph}=setup();let cases=0;
  for(const workspace of ['card','cross-border','hk-cb'])for(const t of await api('/transactions','GET',undefined,workspace)){
    const r=await api('/investigations','POST',{transactionId:t.id},workspace),nodes=graph.build(r);
    const ids=Array.from(nodes.flatMap(n=>n.evidence.map(e=>e.id)));
    assert.deepEqual(ids.sort(),Array.from(r.evidence,e=>e.id).sort());assert.equal(new Set(ids).size,ids.length);
    for(const n of nodes)if(!n.evidence.length)assert.equal(n.state,'unknown');
    assert(nodes.every(n=>n.label!=='其他关联记录'));cases++;
  }
  assert.equal(cases,9);
});
test('timeout never implies failure and adjacent declined transaction cannot change channel node',async()=>{
  const {api,graph}=setup();
  const success=await api('/investigations','POST',{transactionId:'T202609200001'});
  assert.equal(graph.build(success)[1].state,'observed');assert.equal(graph.build(success)[3].state,'alert');assert.equal(graph.build(success)[4].state,'unknown');
  const timeout=await api('/investigations','POST',{transactionId:'T202609200003'});
  assert.equal(graph.build(timeout)[1].state,'pending');
  const updated=await api('/investigations/'+success.id+'/supplement','POST',{outcome:'completed',revision:0});
  assert.equal(graph.build(updated)[4].state,'observed');assert.equal(graph.build(updated)[3].state,'alert');
});
test('disabling evidence sources does not imply execution; graph text is escaped',async()=>{
  const {api,graph}=setup(),services=await api('/services');
  await api('/services','PUT',services.map(s=>({...s,enabled:false})));
  const r=await api('/investigations','POST',{transactionId:'T202609200001'});
  assert(graph.build(r).every(n=>n.state==='unknown'));
  r.pipeline=[{label:'<img src=x onerror=alert(1)>',service:'trx',detail:'<script>'}];
  assert(!graph.render(r).includes('<img'));assert(graph.render(r).includes('&lt;img'));
});
