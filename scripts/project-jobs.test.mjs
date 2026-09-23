import test from 'node:test';
import assert from 'node:assert/strict';
import {projectJobs} from './project-jobs.mjs';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readProjects,writeProjects} from './projects.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(check){for(let i=0;i<200;i++){if(check())return;await tick()}assert.fail('task did not settle')}
function harness(analyze,save){
  let store={version:1,projects:['a','b','c'].map(id=>({id,workspace:id==='c'?'other':'card',revision:1,analysis:{summary:'old'}}))};
  const jobs=projectJobs({getStore:()=>store,saveStore:async next=>{await save?.(next);store=structuredClone(next)},analyze});
  return {jobs,get:()=>store,project:id=>store.projects.find(p=>p.id===id)};
}
test('background task survives absent observers; duplicate IDs and concurrency are bounded',async()=>{
  let calls=0;const wait=deferred();
  const h=harness(async()=>{calls++;return wait.promise});
  const task=await h.jobs.start('a','card',{},'');
  assert.equal((await h.jobs.start('a','card',{},'')).id,task.id);
  await h.jobs.start('b','card',{},'');
  await assert.rejects(h.jobs.start('c','other',{},''),/两个/);
  assert.equal(calls,2);assert.equal(h.project('a').task.status,'running');
  await assert.rejects(h.jobs.cancel('a','other',task.id),/未找到/);
  await assert.rejects(h.jobs.cancel('a','card','wrong'),/已更新/);
  wait.resolve({summary:'new'});await until(()=>!h.jobs.busy());
  assert.equal(h.project('a').analysis.summary,'new');
  assert.equal(h.project('a').task.status,'completed');
});
test('cancel wins before final save, failures keep old result and retries get fresh IDs',async()=>{
  const wait=deferred();const h=harness(()=>wait.promise);
  const first=await h.jobs.start('a','card',{},'');
  await h.jobs.cancel('a','card',first.id);wait.resolve({summary:'must not save'});
  await until(()=>!h.jobs.busy());assert.equal(h.project('a').analysis.summary,'old');
  assert.equal(h.project('a').task.status,'cancelled');
  const failed=harness(async()=>{throw Error('output truncated')});
  await failed.jobs.start('a','card',{},'');await until(()=>!failed.jobs.busy());
  assert.equal(failed.project('a').task.status,'failed');assert.equal(failed.project('a').analysis.summary,'old');
  const second=await h.jobs.start('a','card',{},'');assert.notEqual(first.id,second.id);await until(()=>!h.jobs.busy());
});
test('success wins once atomic save has started; cancellation cannot undo a committed result',async()=>{
  const saving=deferred(),release=deferred();
  const h=harness(async()=>({summary:'new'}),async next=>{if(next.projects[0].task?.status==='completed'){saving.resolve();await release.promise}});
  const task=await h.jobs.start('a','card',{},'');await saving.promise;
  const cancel=h.jobs.cancel('a','card',task.id);release.resolve();
  assert.equal((await cancel).status,'completed');await until(()=>!h.jobs.busy());
  assert.equal(h.project('a').analysis.summary,'new');
});
test('failed final persistence keeps previous successful analysis',async()=>{
  const h=harness(async()=>({summary:'new'}),async next=>{if(next.projects[0].task?.status==='completed')throw Error('disk unavailable')});
  await h.jobs.start('a','card',{},'');await until(()=>!h.jobs.busy());
  assert.equal(h.project('a').analysis.summary,'old');assert.equal(h.project('a').task.status,'failed');
});
test('restart marks persisted running tasks interrupted and permits retry',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'paytrace-jobs-')),file=path.join(dir,'projects.json');
  let store={version:1,projects:[{id:'a',workspace:'card',name:'fixture',scanEnabled:false,repoPath:'',repoType:'local',remoteUrl:'',branch:'master',focus:'',revision:1,analysis:{summary:'old'},task:{id:'old-job',status:'running'}}]};
  await writeProjects(file,store);
  store=await readProjects(file);
  const jobs=projectJobs({getStore:()=>store,saveStore:async next=>{await writeProjects(file,next);store=next},analyze:async()=>({summary:'new'})});
  await jobs.recover();assert.equal(store.projects[0].task.status,'interrupted');
  assert.equal(JSON.parse(await readFile(file)).projects[0].analysis.summary,'old');
  await jobs.start('a','card',{},'');await until(()=>!jobs.busy());
  assert.equal((await readProjects(file)).projects[0].analysis.summary,'new');
});

test('total job timeout releases resources and preserves old analysis as a failed task',async t=>{
  const original=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>original(fn,ms===30000?10:ms,...args));
  const h=harness(async(p,c,m,e,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  await h.jobs.start('a','card',{},'',30);await until(()=>!h.jobs.busy());
  assert.equal(h.project('a').task.status,'failed');assert.match(h.project('a').task.message,/总时限/);assert.equal(h.project('a').analysis.summary,'old');
});
