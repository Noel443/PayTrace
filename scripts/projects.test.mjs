import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {projectCandidate,changeProjects,publicProjects,readProjects,writeProjects,projectSnapshot,validateAnalysis,analyzeProject} from './projects.mjs';
import {config} from './ai.mjs';
const exec=promisify(execFile);
const base={workspace:'card',name:'支付核心',repoPath:'/missing/repo',branch:'master',focus:'支付与通知',scanEnabled:false};
const answer={summary:'支付受理与通知',businesses:['支付受理'],chains:[{name:'支付链路',trigger:'商户提交支付请求',goal:'受理支付并生成交易',outcome:'交易记录已创建；渠道处理未提供',steps:[{label:'受理交易',service:'trx',description:'校验请求后创建交易记录',input:'商户订单号、金额',decision:'重复订单如何处理未说明',stateChange:'新增待处理交易',failure:'失败去向未说明',evidenceIds:['P1']}],transitions:[]}],uncertainties:['未提供渠道实现']};
async function temp(t){const dir=await mkdtemp(path.join(tmpdir(),'paytrace-project-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
test('project settings isolate workspaces and editing preserves an explicitly stale analysis',async t=>{
  let store=changeProjects({version:1,projects:[]},base);const id=store.projects[0].id;
  store.projects[0].analysis={...answer,revision:1};
  assert.throws(()=>changeProjects(store,{...base,workspace:'hk-cb',id}),/未找到/);
  assert.throws(()=>changeProjects(store,base),/同名/);
  const changed=changeProjects(store,{...base,id,branch:'release'});
  assert.equal(store.projects[0].branch,'master');assert.equal(changed.projects[0].revision,2);
  assert.equal(changed.projects[0].analysisStale,true);assert.deepEqual(changed.projects[0].analysis,store.projects[0].analysis);
  assert.equal(publicProjects(changed,'hk-cb').length,0);
  const file=path.join(await temp(t),'projects.json');await writeProjects(file,changed);
  assert.deepEqual(await readProjects(file),changed);assert.equal((await stat(file)).mode&0o777,0o600);
  await assert.rejects(writeProjects(file+'/bad',changed));assert.deepEqual(await readProjects(file),changed);
});
test('project input rejects unsafe branches and relative repositories; defaults to master',()=>{
  assert.equal(projectCandidate({...base,branch:''}).branch,'master');
  for(const branch of ['--all','master~1','master^{tree}','../main','name\nnext'])assert.throws(()=>projectCandidate({...base,branch}));
  assert.throws(()=>projectCandidate({...base,scanEnabled:true,repoPath:'relative'}),/绝对路径/);
});
test('Markdown-only mode never touches repository and redacts common credential assignments',async()=>{
  const snapshot=await projectSnapshot(base,'# 支付\napi_key = "private-value"');
  assert.equal(snapshot.mode,'markdown');assert.equal(snapshot.commit,null);assert.equal(snapshot.documents.length,1);
  assert(!snapshot.documents[0].text.includes('private-value'));
  await assert.rejects(projectSnapshot(base,''),/保存 Markdown/);
});
test('scan reads committed master even when HEAD and worktree differ, skipping secrets and symlinks',async t=>{
  const repo=await temp(t),git=async(...args)=>(await exec('git',['-C',repo,...args])).stdout.trim();
  await git('init','-b','master');await mkdir(path.join(repo,'src'));
  await writeFile(path.join(repo,'README.md'),'# MASTER BUSINESS');
  await writeFile(path.join(repo,'src','PaymentService.java'),'class PaymentService { String password = "hidden-key"; }');
  await writeFile(path.join(repo,'credentials.md'),'DO NOT SEND');
  await writeFile(path.join(repo,'application-prod.md'),'DO NOT SEND');
  await symlink('/etc/passwd',path.join(repo,'linked.md'));
  await mkdir(path.join(repo,'tests'));await writeFile(path.join(repo,'tests','Example.java'),'DO NOT SEND');
  await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','master fixture');
  const master=await git('rev-parse','HEAD');await git('checkout','-b','feature');
  await writeFile(path.join(repo,'README.md'),'# FEATURE BUSINESS');await git('add','.');
  await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','feature fixture');
  await writeFile(path.join(repo,'README.md'),'DIRTY WORKTREE');
  const before=await git('status','--porcelain'),head=await git('rev-parse','HEAD');
  const snapshot=await projectSnapshot({...base,repoPath:repo,scanEnabled:true});
  assert.equal(snapshot.commit,master);assert.equal(snapshot.coverage.total,2);
  assert(snapshot.documents.some(d=>d.text.includes('MASTER BUSINESS')));
  assert(!JSON.stringify(snapshot).includes('hidden-key'));assert(!JSON.stringify(snapshot).includes('DO NOT SEND'));
  assert.equal(await git('rev-parse','HEAD'),head);assert.equal(await git('status','--porcelain'),before);
  assert.equal(await readFile(path.join(repo,'README.md'),'utf8'),'DIRTY WORKTREE');
  await assert.rejects(projectSnapshot({...base,repoPath:repo,scanEnabled:true,branch:'missing'}),/本地分支存在/);
});
test('repository coverage and excerpt bounds are explicit',async t=>{
  const repo=await temp(t),git=async(...args)=>exec('git',['-C',repo,...args]);
  await git('init','-b','master');
  for(let i=0;i<30;i++)await writeFile(path.join(repo,'Service'+i+'.java'),'// business\n'.repeat(1000));
  await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','bounded fixture');
  const snapshot=await projectSnapshot({...base,repoPath:repo,scanEnabled:true});
  assert.equal(snapshot.coverage.total,30);assert(snapshot.coverage.read===30);assert.equal(snapshot.coverage.truncated,false);
  assert(snapshot.documents.every(d=>d.text.length<=18000));assert(snapshot.documents.reduce((n,d)=>n+d.text.length,0)<=2400000);
});
test('model output requires structure and real source IDs, and rejects empty or fabricated chains',async()=>{
  const snapshot=await projectSnapshot(base,'# 业务文档');
  assert.deepEqual(validateAnalysis('```json\n'+JSON.stringify(answer)+'\n```',snapshot),answer);
  for(const value of [{...answer,chains:[]},{...answer,businesses:[]},{...answer,chains:[{name:'凭空推断',steps:[{...answer.chains[0].steps[0],evidenceIds:['P999']}]}]}])assert.throws(()=>validateAnalysis(JSON.stringify(value),snapshot));
  const linked={...answer,chains:[{...answer.chains[0],steps:[...answer.chains[0].steps,{...answer.chains[0].steps[0],label:'消费支付消息'}],transitions:[{from:0,to:1,condition:'发布支付消息后由消费者处理',mode:'async',evidenceIds:['P1']}]}]};
  assert.equal(validateAnalysis(JSON.stringify(linked),snapshot).chains[0].transitions[0].mode,'async');
  for(const transition of [{from:0,to:2,condition:'越界',mode:'sync',evidenceIds:['P1']},{from:0,to:1,condition:'伪造关系',mode:'sync',evidenceIds:['P9']}])assert.throws(()=>validateAnalysis(JSON.stringify({...linked,chains:[{...linked.chains[0],transitions:[transition]}]}),snapshot));
  assert.throws(()=>validateAnalysis('not json',snapshot),/有效的业务链路 JSON/);
});
test('project analysis uses configured streaming model and retains provenance without persisting source text',async()=>{
  const events=[],c=config({AI_PROVIDER:'ollama',AI_MODEL:'fixture-project'});
  const result=await analyzeProject({...base,revision:2},c,'# 业务专属文档内容',(kind,value)=>events.push({kind,value}),{fetcher:async(url,options)=>{if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':262144}});
    assert.equal(url,'http://127.0.0.1:11434/api/chat');
    const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.options.num_predict,16000);
    assert(body.messages[1].content.includes('业务专属文档内容'));assert(body.messages[0].content.includes('状态变化'));assert(body.messages[0].content.includes('异步边'));assert(body.messages[0].content.includes('从业务入口'));
    return new Response(JSON.stringify({message:{content:JSON.stringify(answer)},done:true})+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
  }});
  assert.equal(result.revision,2);assert.equal(result.model,'fixture-project');assert.equal(result.sources[0].file,'workspace-knowledge.md');
  assert.equal(result.sources[0].text,undefined);assert(!JSON.stringify(result).includes('业务专属文档内容'));assert(events.some(e=>e.kind==='delta'));
  await assert.rejects(analyzeProject(base,{enabled:false},'text',()=>{}),/启用 AI/);
});

test('project delete removes its saved analysis, persists and rejects cross-workspace IDs',async t=>{
  let store=changeProjects({version:1,projects:[]},base);const id=store.projects[0].id;
  store.projects[0].analysis=answer;store=changeProjects(store,{...base,workspace:'hk-cb'});
  assert.throws(()=>changeProjects(store,{action:'delete',workspace:'hk-cb',id}),/未找到/);
  const next=changeProjects(store,{action:'delete',workspace:'card',id});
  assert.equal(next.projects.length,1);assert.equal(store.projects.length,2);
  const file=path.join(await temp(t),'projects.json');await writeProjects(file,next);
  assert.equal(publicProjects(await readProjects(file),'card').length,0);
  assert.equal(publicProjects(await readProjects(file),'hk-cb').length,1);
});

test('multiple batches and synthesis preserve source IDs and exact line ranges including file tails',async t=>{
  const repo=await temp(t),git=async(...args)=>exec('git',['-C',repo,...args]);
  await git('init','-b','master');
  for(let i=0;i<35;i++)await writeFile(path.join(repo,'Payment'+i+'Service.java'),Array.from({length:1600},(_,line)=>'// source '+i+' line '+(line+1)).join('\n'));
  await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','batch fixture');
  const snapshot=await projectSnapshot({...base,repoPath:repo,scanEnabled:true});
  assert.equal(snapshot.coverage.read,35);assert(snapshot.documents.some(d=>d.startLine>1000));
  for(const d of snapshot.documents){
    const lines=(await readFile(path.join(repo,d.file),'utf8')).split('\n');
    assert.equal(d.text,lines.slice(d.startLine-1,d.endLine).join('\n'));
  }
  let batches=0,summaries=0;
  const result=await analyzeProject({...base,repoPath:repo,scanEnabled:true},config({AI_PROVIDER:'ollama',AI_MODEL:'mock'}),'',()=>{},{fetcher:async(url,options)=>{if(url.endsWith('/api/show'))return Response.json({model_info:{'mock.context_length':262144}});
    const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
    let ids;if(payload.documents){batches++;ids=[payload.documents[0].id]}else{summaries++;ids=[payload.sources[0].id]}
    const output={...answer,chains:[{...answer.chains[0],steps:[{...answer.chains[0].steps[0],evidenceIds:ids}]}]};
    return new Response(JSON.stringify({message:{content:JSON.stringify(output)},done:true})+'\n');
  }});
  assert(batches>1);assert.equal(summaries,1);assert.equal(result.coverage.batches,batches);
  assert(result.sources.every(s=>!('text' in s)));assert.equal(result.coverage.truncated,true);
});

test('thousands of candidates disclose file-budget omissions instead of claiming whole-repository coverage',async t=>{
  const repo=await temp(t),git=async(...args)=>exec('git',['-C',repo,...args]);
  await git('init','-b','master');
  for(let i=0;i<2566;i++)await writeFile(path.join(repo,'Item'+i+'.java'),'class Item'+i+' {}');
  await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','coverage fixture');
  const snapshot=await projectSnapshot({...base,repoPath:repo,scanEnabled:true});
  assert.equal(snapshot.coverage.total,2566);assert.equal(snapshot.coverage.read,400);
  assert.equal(snapshot.coverage.omissions.length,2166);assert.equal(snapshot.coverage.truncated,true);
  assert(snapshot.coverage.omissions.every(o=>o.reason.includes('预算')));
});

test('support-only batches may have no business chains but final analysis must contain a grounded use case',async()=>{
  const snapshot=await projectSnapshot(base,'support code'),empty={summary:'只有支撑资料 P1',businesses:[],chains:[],uncertainties:['入口未提供']};
  assert.equal(validateAnalysis(JSON.stringify(empty),snapshot,{allowEmpty:true}).chains.length,0);
  assert.throws(()=>validateAnalysis(JSON.stringify(empty),snapshot),/数量或结构/);
});
