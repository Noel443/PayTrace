import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){
  const data=new Map();let fail=false;
  const c=vm.createContext({window:{},structuredClone,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('quota');data.set(k,v)}}});
  for(const file of ['workspaces','investigation','mock-api'])vm.runInContext(readFileSync(new URL(`../frontend/${file}.js`,import.meta.url),'utf8'),c);
  return {api:c.window.demoApi,inspect:c.window.investigation.inspect,fail:()=>fail=true};
}
const create=api=>api('/investigations','POST',{transactionId:'T202609200001'});
test('completed merchant evidence revises advice, retains original and survives reopening',async()=>{
  const {api,inspect}=setup();const r=await create(api);const original=r.title;
  assert.equal(inspect(r).parties[2].state,'订单状态待核实');
  const next=await api(`/investigations/${r.id}/supplement`,'POST',{outcome:'completed'});
  assert.equal(next.original.title,original);assert.match(next.title,/已完成/);
  assert.equal(inspect(next).parties[2].state,'订单已完成');assert.equal(next.evidence.length,r.evidence.length+1);
  assert.match(next.actions.join(''),/不要.*再次扣款/);
  assert.equal((await api(`/investigations/${r.id}`)).supplement.outcome,'completed');
  await assert.rejects(api(`/investigations/${r.id}/supplement`,'POST',{outcome:'pending'}),/已补证/);
  await assert.rejects(api(`/investigations/${r.id}/ai`,'POST',{status:'completed',text:'旧结果',revision:0}),/过期/);
  assert.equal((await api(`/investigations/${r.id}/ai`,'POST',{status:'completed',text:'新结果',revision:1})).ai.text,'新结果');
});
test('pending evidence does not prove notification was never received',async()=>{
  const {api}=setup();const r=await create(api);
  const next=await api(`/investigations/${r.id}/supplement`,'POST',{outcome:'pending'});
  assert.match(next.title,/仍待支付/);assert.match(next.summary,/不能证明商户未收到/);
  assert.equal(next.transaction.status,'SUCCESS');
});
test('missing logs stay unknown, and other scenarios reject merchant supplements',async()=>{
  const {api,inspect}=setup();await api('/services','PUT',(await api('/services')).map(s=>({...s,enabled:false})));
  const r=await create(api);assert.equal(inspect(r).parties[0].state,'最终结果未知');
  const next=await api(`/investigations/${r.id}/supplement`,'POST',{outcome:'completed'});
  assert.match(next.uncertainties.join(''),/缺少完整通知/);
  for(const id of ['T202609200002','T202609200003']){
    const other=await api('/investigations','POST',{transactionId:id});
    await assert.rejects(api(`/investigations/${other.id}/supplement`,'POST',{outcome:'completed'}),/暂不支持/);
  }
});
test('bad input and failed persistence do not change the stored report',async()=>{
  const {api,fail}=setup();const r=await create(api);
  await assert.rejects(api(`/investigations/${r.id}/supplement`,'POST',{outcome:'invented'}),/有效/);
  fail();await assert.rejects(api(`/investigations/${r.id}/supplement`,'POST',{outcome:'completed'}),/未保存/);
  assert.equal((await api(`/investigations/${r.id}`)).supplement,undefined);
});
