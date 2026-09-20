import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sourceCandidate,changeSources,publicSources,readSources,writeSources} from './log-sources.mjs';
const input={action:'save',workspace:'card',name:'交易服务主节点',service:'trx',environment:'测试环境',host:'10.0.0.12',port:22,username:'operator',password:'private-test-password',logPath:'/var/log/pay/trx.log',enabled:true};
test('sources are workspace scoped and public responses never contain passwords',()=>{
  let store=changeSources({version:1,sources:[]},input);const first=store.sources[0];
  store=changeSources(store,{...input,workspace:'hk-cb',password:'another-password'});
  assert.equal(publicSources(store,'card').length,1);assert.equal(publicSources(store,'hk-cb').length,1);
  assert.equal(publicSources(store,'cross-border').length,0);
  assert(!JSON.stringify(publicSources(store,'card')).includes(input.password));
  assert.equal(publicSources(store,'card')[0].hasPassword,true);
  assert.throws(()=>changeSources(store,{...input,id:first.id,workspace:'hk-cb'}),/未找到/);
  const toggled=changeSources(store,{action:'toggle',workspace:'card',id:first.id,enabled:false});
  assert.equal(toggled.sources[0].enabled,false);assert.equal(toggled.sources[1].enabled,true);
  assert.equal(store.sources[0].enabled,true);
});
test('password retention is restricted to the same workspace, server, port and account',()=>{
  const current=sourceCandidate(input);
  assert.equal(sourceCandidate({...input,password:''},current).password,input.password);
  assert.equal(sourceCandidate({...input,password:'replacement'},current).password,'replacement');
  for(const patch of [{host:'10.0.0.13'},{port:2222},{username:'other'},{workspace:'hk-cb'}])assert.throws(()=>sourceCandidate({...input,...patch,password:''},current),/重新填写/);
  for(const patch of [{port:0},{port:65536},{host:'https://example.com'},{logDirectory:'logs'},{workspace:'../other'},{service:'trx;command'}])assert.throws(()=>sourceCandidate({...input,...patch}));
});
test('source file persists with 0600 permissions and failed writes preserve the old store',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-sources-'));
  try{
    const file=path.join(dir,'sources.json');assert.deepEqual(await readSources(file),{version:1,sources:[]});
    const store=changeSources({version:1,sources:[]},input);await writeSources(file,store);
    assert.equal((await stat(file)).mode&0o777,0o600);assert.deepEqual(await readSources(file),store);
    await assert.rejects(writeSources(dir,store));assert.deepEqual(await readSources(file),store);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('relative log files and home paths persist with an explicit base; old absolute paths remain valid',()=>{
  for(const logPath of ['trx-console.log','./daemon-console.log','~/logs/merchant-console.log','/data/logs/boss-console.log']){
    const saved=sourceCandidate({...input,logPath,logDirectory:'~/logs'});
    assert.equal(saved.logPath,logPath);assert.equal(saved.logDirectory,'~/logs');
  }
  assert.equal(sourceCandidate(input).logDirectory,'');
  assert.throws(()=>sourceCandidate({...input,logDirectory:'/logs\ncommand'}));
});

test('delete removes only the chosen source and credentials, persists and rejects wrong scopes',async t=>{
  let store=changeSources({version:1,sources:[]},input);
  const id=store.sources[0].id;store=changeSources(store,{...input,workspace:'hk-cb'});
  assert.throws(()=>changeSources(store,{action:'delete',workspace:'hk-cb',id}),/未找到/);
  assert.throws(()=>changeSources(store,{action:'delete',workspace:'card'}),/请选择/);
  const next=changeSources(store,{action:'delete',workspace:'card',id});
  assert.equal(next.sources.length,1);assert.equal(store.sources.length,2);
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-delete-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'sources.json');await writeSources(file,next);
  assert.equal(publicSources(await readSources(file),'card').length,0);
  assert.equal(publicSources(await readSources(file),'hk-cb').length,1);
});
