import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {logCommand,runSsh,sshFailure} from './ssh-logs.mjs';
const source={enabled:true,host:'127.0.0.1',port:22,username:'operator',password:'test-private-password',logPath:'/var/log/trx.log'};
test('readonly command quotes file and query literally, preserving special characters',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-shell-'));
  try{
    const logPath=path.join(dir,"trx' $(printf INJECTED).log"),query="TX' $(printf EXECUTED)";
    await writeFile(logPath,'before\n'+query+'\nafter\n');
    const check=spawnSync('sh',['-c',logCommand({...source,logPath},'test')],{encoding:'utf8'});assert.equal(check.status,0);assert.match(check.stdout,/PAYTRACE_READABLE/);
    const found=spawnSync('sh',['-c',logCommand({...source,logPath},'search',query)],{encoding:'utf8'});assert.equal(found.status,0);assert(found.stdout.includes('2:'+query));
    assert.equal(spawnSync('sh',['-c',logCommand({...source,logPath},'search','NO_MATCH')]).status,1);
    assert.equal(spawnSync('sh',['-c',logCommand({...source,logPath:dir+'/missing'},'test')]).status,41);
    assert.equal(spawnSync('sh',['-c',logCommand({...source,logPath:dir},'test')]).status,42);
    assert.throws(()=>logCommand(source,'search','a\nb'),/换行/);assert.throws(()=>logCommand(source,'execute','ls'),/不支持/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
function processStub(callback){return (command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdio=[null,child.stdout,child.stderr,new PassThrough()];
  let password='';child.stdio[3].on('data',part=>password+=part);
  setImmediate(()=>callback({child,command,args,options,password}));return child;
};}
test('SSH password goes through fd 3, host verification is enforced, and success closes session',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-ssh-'));
  try{
    const result=await runSsh(source,{knownHostsFile:dir+'/known_hosts',spawnProcess:processStub(({child,command,args,options,password})=>{
      assert.equal(command,'sshpass');assert.equal(args[0],'-d');assert.equal(args[1],'3');assert(!args.join(' ').includes(source.password));assert.equal(password,source.password+'\n');
      assert(args.includes('StrictHostKeyChecking=accept-new'));assert.equal(options.env,undefined);
      child.stdout.write('PAYTRACE_READABLE\n');child.emit('close',0);
    })});assert.equal(result.ok,true);assert.equal(result.output,'');
    await assert.rejects(runSsh({...source,host:'0.0.0.0'},{knownHostsFile:dir+'/known_hosts'}),/实际服务器/);
    await assert.rejects(runSsh({...source,enabled:false},{knownHostsFile:dir+'/known_hosts'}),/停用/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('auth errors, timeouts, output limits and cancellation are explicit',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-ssh-errors-'));
  const options={knownHostsFile:dir+'/known_hosts'};
  try{
    await assert.rejects(runSsh(source,{...options,spawnProcess:processStub(({child})=>{child.stderr.write('Permission denied PRIVATE');child.emit('close',5)})}),error=>error.message.includes('认证失败')&&!error.message.includes('PRIVATE'));
    await assert.rejects(runSsh(source,{...options,timeoutMs:20,spawnProcess:processStub(()=>{})}),/已停止/);
    const output=await runSsh(source,{...options,action:'search',query:'T1',maxBytes:10,spawnProcess:processStub(({child})=>child.stdout.write('0123456789abcdef'))});assert.equal(output.truncated,true);assert.equal(output.output,'0123456789');
    const controller=new AbortController();await assert.rejects(runSsh(source,{...options,signal:controller.signal,spawnProcess:processStub(()=>controller.abort())}),/取消/);
    assert.match(sshFailure(255,'REMOTE HOST IDENTIFICATION HAS CHANGED'),/不会自动覆盖/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('relative paths resolve against configured directory or remote home, never the shell working directory',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-relative-'));
  try{
    const name="trx-console' $(printf INJECTED).log";
    await writeFile(path.join(dir,name),'TX123\n');
    for(const config of [
      {logPath:name,logDirectory:dir},
      {logPath:name},
      {logPath:'~/'+name,logDirectory:'/missing'},
      {logPath:name,logDirectory:'~'},
      {logPath:name,logDirectory:'~/.'},
      {logPath:path.join(dir,name),logDirectory:'/missing'}
    ]){
      const result=spawnSync('sh',['-c',logCommand({...source,...config},'search','TX123')],{cwd:'/',env:{...process.env,HOME:dir},encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/1:TX123/);
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('menu transport uses bastion password and PTY, then reads only framed target output',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-menu-'));
  try{
    const result=await runSsh({...source,connectionMode:'menu',jumpPassword:'bastion-password',jumpHost:'bastion.test',jumpPort:60022,jumpUsername:'operator'}, {
      knownHostsFile:dir+'/known_hosts',
      spawnProcess:(command,args,options)=>{
        assert(args.includes('-tt'));assert(!args.includes('-J'));assert.equal(args.at(-1),'bastion.test');assert(args.includes('60022'));assert.equal(options.stdio[0],'pipe');
        const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdio=[child.stdin,child.stdout,child.stderr,new PassThrough()];
        let writes=0;
        child.stdin.on('data',chunk=>{
          if(writes++===0){assert.equal(chunk.toString(),':');setImmediate(()=>child.stdout.write(':'));}
          else if(writes===2){assert.equal(chunk.toString(),'ssh operator@127.0.0.1:22\r');setImmediate(()=>child.stdout.write('-bash-4.2$ '));}
          else {const token=chunk.toString().match(/PT_BEGIN_' '([a-f0-9]+)'/)[1];setImmediate(()=>child.stdout.write(`\nPT_BEGIN_${token}\nPAYTRACE_READABLE\n\nPT_END_${token}:0\n`));}
        });
        child.stdio[3].on('data',chunk=>assert.equal(chunk.toString(),'bastion-password\n'));
        setImmediate(()=>child.stdout.write('[usmshell]\n001: menu 127.0.0.1:22 ssh operator\n'));return child;
      }
    });assert.equal(result.ok,true);assert.equal(result.output,'');
  }finally{await rm(dir,{recursive:true,force:true})}
});
