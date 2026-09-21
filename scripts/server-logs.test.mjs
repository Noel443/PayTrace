import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {runServerLogs} from './server-logs.mjs';
import {logCommand} from './ssh-logs.mjs';
import {sourceCandidate} from './log-sources.mjs';
import {investigate} from './real-investigation.mjs';
const source={workspace:'card',enabled:true,name:'QA',service:'auto',host:'127.0.0.1',port:22,username:'qa',password:'example',environment:'QA',logDirectory:'/logs',logs:[{logPath:'*-console.log',service:''}]};
test('wildcard discovery selects current console files, not dated archives or error files',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'paytrace-logs-'));
 try{
  for(const file of ['trx-console.log','daemon-console.log','merchant-console.log','boss-console.log','trx-console.2026-09-20.log','trx-error.log'])await writeFile(path.join(dir,file),'');
  const command=logCommand({...source,logDirectory:dir,logPath:'*-console.log'},'discover');
  const output=execFileSync('sh',['-c',command],{encoding:'utf8'});
  assert.deepEqual(output.trim().split('\n').sort(),['./boss-console.log','./daemon-console.log','./merchant-console.log','./trx-console.log']);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('multi-file queries preserve services, deduplicate overlaps, and report partial failures',async()=>{
 const calls=[];
 const result=await runServerLogs({...source,logs:[...source.logs,{logPath:'trx-console.log',service:'trx'}]},{action:'search',query:'ORDER-1'},async(s,o)=>{
  calls.push([s.logPath,o.action]);
  if(o.action==='discover')return {output:'./trx-console.log\n./daemon-console.log\n'};
  if(s.logPath==='daemon-console.log')throw Error('无权读取');
  return {output:'1:ORDER-1 success',ok:true};
 });
 assert.equal(calls.length,3);assert.equal(result.files.length,2);assert.equal(result.files[0].service,'trx');assert.equal(result.files[1].error,'无权读取');assert.equal(result.ok,false);
});
test('configuration accepts multiple rules, validates patterns and retains legacy fields',()=>{
 const result=sourceCandidate(source);assert.equal(result.logs.length,1);assert.equal(result.logPath,'*-console.log');
 assert.throws(()=>sourceCandidate({...source,logs:[{logPath:'$(touch x)*.log'}]}));
 assert.throws(()=>sourceCandidate({...source,logs:[]}));
 assert.throws(()=>sourceCandidate({...source,logs:[{logPath:'../*.log'}]}));
});
test('file discovery enforces 20-file limit and exposes missing matches',async()=>{
 const result=await runServerLogs(source,{action:'search'},async(s,o)=>({output:o.action==='discover'?Array.from({length:25},(_,i)=>'./service'+i+'-console.log').join('\n'):'1:order'}));
 assert.equal(result.files.filter(f=>!f.error).length,20);assert.match(result.files.at(-1).error,/20/);
 const empty=await runServerLogs(source,{},async()=>({output:''}));assert.match(empty.files[0].error,/没有找到/);
});
test('AI receives cross-service file provenance and failed-file coverage',async()=>{
 let payload;
 const result=await investigate({workspace:'card',transactionId:'ORDER-1',question:'哪里失败',markdown:''},[source],{enabled:true},()=>{},{search:async()=>({files:[{logPath:'trx-console.log',service:'trx',output:'2:ORDER-1 success'},{logPath:'daemon-console.log',service:'daemon',output:'4:ORDER-1 timeout'},{logPath:'boss-console.log',service:'boss',error:'unreadable'}]}),model:async(c,m)=>{payload=JSON.parse(m[1].content);return {status:'completed',text:'结果'}}});
 assert.deepEqual(payload.evidence.map(e=>e.service),['trx','daemon']);assert.equal(payload.evidence[1].file,'daemon-console.log');assert.equal(result.coverage[2].status,'failed');assert.equal(result.coverage[2].file,'boss-console.log');
});
