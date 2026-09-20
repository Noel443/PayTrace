import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {withRemoteProject,remoteUrl} from './remote-project.mjs';
import {projectCandidate,projectSnapshot} from './projects.mjs';
const project={workspace:'card',name:'远程支付',scanEnabled:true,repoType:'remote',remoteUrl:'https://git.example.test/team/payment.git',branch:'master'};
test('remote configuration accepts HTTP(S), defaults legacy projects to local, and rejects embedded credentials and other protocols',()=>{
  assert.equal(projectCandidate(project).remoteUrl,project.remoteUrl);
  assert.equal(remoteUrl('http://git.internal:8080/team/payment.git'),'http://git.internal:8080/team/payment.git');
  assert.equal(projectCandidate({...project,repoType:undefined,scanEnabled:false}).repoType,'local');
  for(const url of ['file:///tmp/repo','ssh://git@host/repo','https://user:token@host/repo','https://host/repo?token=secret','https://host/repo#main','--upload-pack=bad'])assert.throws(()=>remoteUrl(url));
  assert.throws(()=>projectCandidate({...project,remoteUrl:''}),/仓库地址/);
});
test('remote checkout is shallow, branch-specific, noninteractive and cleaned after snapshot',async()=>{
  let temp;
  const snapshot=await withRemoteProject(project,async repo=>{temp=repo;await access(repo);return {commit:'verified',documents:[]}}, {runner:async(command,args,options)=>{
    assert.equal(command,'git');assert(args.includes('--no-checkout'));assert(args.includes('--single-branch'));assert(args.includes('--no-tags'));
    assert.equal(args[args.indexOf('--branch')+1],'master');assert.equal(args[args.indexOf('--depth')+1],'1');
    assert.equal(options.env.GIT_TERMINAL_PROMPT,'0');assert.equal(options.env.GIT_ALLOW_PROTOCOL,'http:https');
    assert.equal(args.at(-2),project.remoteUrl);await mkdir(args.at(-1));await writeFile(args.at(-1)+'/fixture','test');
  }});
  assert.equal(snapshot.commit,'verified');await assert.rejects(access(temp));
});
test('remote failures sanitize Git diagnostics, clean temporary clones and never call snapshot',async()=>{
  for(const stderr of ['fatal: Authentication failed token=SECRET','fatal: Remote branch master not found','unrecognized SECRET']){
    let temp,read=false;
    await assert.rejects(withRemoteProject(project,async()=>{read=true},{runner:async(command,args)=>{temp=args.at(-1);await mkdir(temp);throw Object.assign(Error('SECRET'),{stderr})}}),e=>!e.message.includes('SECRET'));
    assert.equal(read,false);await assert.rejects(access(temp));
  }
});
test('remote cancellation and downstream failure clean temporary directory',async()=>{
  let temp;const controller=new AbortController();
  await assert.rejects(withRemoteProject(project,async()=>{throw Error('unexpected')},{signal:controller.signal,runner:async(command,args)=>{temp=args.at(-1);await mkdir(temp);controller.abort();throw Error('canceled')}}),/已停止/);
  await assert.rejects(access(temp));
  await assert.rejects(withRemoteProject(project,async()=>{throw Error('snapshot failure')},{runner:async(command,args)=>{temp=args.at(-1);await mkdir(temp)}}),/snapshot failure/);
  await assert.rejects(access(temp));
});
test('disabled scan uses Markdown without trying remote network',async()=>{
  const snapshot=await projectSnapshot({...project,scanEnabled:false},'# 文档');assert.equal(snapshot.mode,'markdown');
});
