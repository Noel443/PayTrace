import test from 'node:test';
import assert from 'node:assert/strict';
import {investigate} from './real-investigation.mjs';
const input={workspace:'card',transactionId:'ORDER-1',question:'为什么超时',markdown:'业务文档'};
const sources=[{workspace:'card',enabled:true,name:'trx',service:'trx',logPath:'/logs/trx.log',environment:'test'},{workspace:'hk-cb',enabled:true,name:'other'},{workspace:'card',enabled:false,name:'disabled'}];
const config={enabled:true};
test('queries only enabled sources in workspace and sends matching evidence to AI',async()=>{
  const calls=[];let payload;
  const report=await investigate(input,sources,config,()=>{},{search:async(s,o)=>{calls.push(s.name);assert.equal(o.query,'ORDER-1');return {output:'10-before ORDER-2\n11:ORDER-1 timeout\n12-after ORDER-2\n13:unrelated'}},model:async(c,m)=>{payload=JSON.parse(m[1].content);return {status:'completed',text:'分析 [E1]'}}});
  assert.deepEqual(calls,['trx']);assert.equal(report.kind,'real');assert.equal(report.evidence.length,1);assert.equal(report.evidence[0].line,11);assert.equal(payload.markdown,'业务文档');assert.equal(report.ai.status,'completed');
});
test('no evidence avoids AI call and reports server failure',async()=>{
  const report=await investigate(input,sources,config,()=>{},{search:async()=>{throw Error('连接失败')},model:async()=>assert.fail('must not call AI')});
  assert.equal(report.ai.status,'disabled');assert.equal(report.coverage[0].status,'failed');
});
test('partial failures retain evidence and model errors retain report',async()=>{
  const report=await investigate(input,[sources[0],{...sources[0],name:'failed'}],config,()=>{},{search:async s=>{if(s.name==='failed')throw Error('timeout');return {output:'1:ORDER-1 pending',truncated:true}},model:async()=>{throw Error('model unavailable')}});
  assert.equal(report.evidence.length,1);assert.equal(report.coverage[0].truncated,true);assert.equal(report.coverage[1].status,'failed');assert.equal(report.ai.status,'failed');
});
test('validation and cancellation prevent remote work',async()=>{
  const options={search:async()=>assert.fail('must not query')};
  await assert.rejects(investigate({...input,transactionId:'a\nb'},sources,config,()=>{},options));
  await assert.rejects(investigate(input,sources,{enabled:false},()=>{},options));
  await assert.rejects(investigate(input,[],config,()=>{},options));
  await assert.rejects(investigate(input,sources,config,()=>{},{...options,signal:AbortSignal.abort()}));
});
test('bounds evidence and discloses omitted lines',async()=>{
 const report=await investigate(input,sources,config,()=>{},{search:async()=>({output:'1:ORDER-1 '+ 'x'.repeat(46000)+'\n2:ORDER-1 ok'}),model:async()=>({status:'completed',text:'ok'})});
 assert.equal(report.evidence.length,1);assert.equal(report.evidence[0].line,2);assert.equal(report.coverage[0].omitted,1);
});
