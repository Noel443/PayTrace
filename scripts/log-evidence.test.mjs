import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLogEvidence} from './log-evidence.mjs';
import {logCommand} from './ssh-logs.mjs';
import {investigate} from './real-investigation.mjs';
const source={workspace:'card',enabled:true,name:'fixture',environment:'test',service:'trx',logPath:'trx.log'};
const request='2026-01-01 10:00:00.100 [worker-1] INFO merchant request orderNo=ORDER-TEST';
const error='2026-01-01 10:00:00.120 [worker-1] ERROR handler:';
const fixture='10:'+request+'\n11-'+error+'\n12-java.lang.RuntimeException: Invalid AES key length (must be 16 bytes)\n13-    at example.AES.decrypt(AES.java:49)';
test('request-adjacent exception without order ID and multiline stack reach the model',async()=>{
 const calls=[];
 const report=await investigate({workspace:'card',transactionId:'ORDER-TEST',question:'原因是什么',markdown:''},[source],{enabled:true},()=>{},{search:async(s,o)=>{calls.push(o.contextLines);return {output:o.contextLines?fixture:'10:'+request,contextLines:o.contextLines}},model:async(c,m)=>{const payload=JSON.parse(m[1].content);assert.match(payload.evidence[0].context,/Invalid AES key length/);assert.match(payload.evidence[0].context,/AES.java:49/);return {status:'completed',text:'解密异常 [E1]'}}});
 assert.deepEqual(calls,[0,100]);assert.equal(report.evidence[0].line,10);assert.equal(report.coverage[0].contextLines,100);
});
test('locates all sources first, then expands only hit files with increasing radii',async()=>{
 const calls=[];
 const result=await collectLogEvidence([source,{...source,name:'other'}],'ORDER-TEST',()=>{},{search:async(s,o)=>{
 calls.push([s.name,o.contextLines]);return {output:s.name==='other'?'':o.contextLines>=500?fixture:'10:'+request};
 }});
 assert.deepEqual(calls,[['fixture',0],['other',0],['fixture',100],['fixture',200],['fixture',500]]);
 assert.match(result.evidence[0].context,/RuntimeException/);
});
test('unrelated thread errors do not stop expansion; exhausted coverage is explicit',async()=>{
 const radii=[];
 const result=await collectLogEvidence([source],'ORDER-TEST',()=>{},{search:async(s,o)=>{radii.push(o.contextLines);return {output:fixture.replace('[worker-1] ERROR','[worker-2] ERROR')}}});
 assert.deepEqual(radii,[0,100,200,500,1000]);assert.match(result.coverage[0].stopReason,/1000/);
});
test('failed expansion retains anchors, cancellation never becomes a report',async()=>{
 const result=await collectLogEvidence([source],'ORDER-TEST',()=>{},{search:async(s,o)=>{if(o.contextLines)throw Error('read failed');return {output:'10:'+request}}});
 assert.equal(result.evidence.length,1);assert.equal(result.coverage[0].contextError,'read failed');
 const controller=new AbortController();
 await assert.rejects(collectLogEvidence([source],'ORDER-TEST',()=>{},{signal:controller.signal,search:async()=>{controller.abort();throw Error('cancel')}}));
});
test('range validation prevents injection and supports literal bounded grep',()=>{
 for(const radius of [0,100,200,500,1000])assert.ok(logCommand(source,'search','ORDER-TEST',radius).includes('-C '+radius+' --'));
 for(const radius of [-1,2000,'100;echo injected'])assert.throws(()=>logCommand(source,'search','ORDER-TEST',radius),/范围/);
});
test('remote truncation is disclosed without claiming full context',async()=>{
 const result=await collectLogEvidence([source],'ORDER-TEST',()=>{},{search:async(s,o)=>({output:o.contextLines?fixture:'10:'+request,truncated:!!o.contextLines})});
 assert.equal(result.coverage[0].truncated,true);assert.match(result.coverage[0].stopReason,/截断/);
});
test('distant correlated exception survives noisy context compaction and gaps are disclosed',async()=>{
 const noisy=Array.from({length:400},(_,i)=>`${i+11}-2026-01-01 10:00:00.110 [other-worker] INFO ${'x'.repeat(100)}`).join('\n');
 const result=await collectLogEvidence([source],'ORDER-TEST',()=>{},{search:async(s,o)=>({output:'10:'+request+(o.contextLines>=500?'\n'+noisy+'\n411-'+error+'\n412-java.lang.RuntimeException: sample failure\n413-    at example.decrypt(Test.java:1)':'')})});
 assert.match(result.evidence[0].context,/sample failure/);assert.match(result.evidence[0].context,/Test.java:1/);
 assert.ok(result.coverage[0].omitted>0);assert.match(result.evidence[0].context,/中间日志未纳入/);
 assert.ok(result.evidence.reduce((n,e)=>n+e.text.length+e.context.length,0)<=45000);
});
test('truncation before anchor is not misreported as file rotation',async()=>{
 const result=await collectLogEvidence([source],'ORDER-TEST',()=>{},{search:async(s,o)=>({output:o.contextLines?'1-before':'10:'+request,truncated:!!o.contextLines})});
 assert.equal(result.coverage[0].truncated,true);assert.match(result.coverage[0].stopReason,/截断/);assert.equal(result.evidence[0].text,request);
});
