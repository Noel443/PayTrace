import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidate,publicConfig,writeConfig,readConfig,isLocalConfigRequest} from './model-config.mjs';

const original={provider:'compatible',base:'https://example.test/v1',model:'demo',key:'private-key',enabled:true};
test('retain key only for same endpoint, replace and explicitly clear',()=>{
  const input={provider:original.provider,base:original.base,model:'new-model',key:''};
  assert.equal(candidate(input,original).key,'private-key');
  assert.equal(candidate({...input,key:'replacement'},original).key,'replacement');
  assert.equal(candidate({...input,clearKey:true},original).enabled,false);
  assert.throws(()=>candidate({...input,base:'https://different.test'},original),/重新填写/);
  assert.throws(()=>candidate({...input,base:'https://example.test/?key=secret'},original),/接口地址/);
  assert.equal(candidate({...input,provider:'ollama',base:'http://127.0.0.1:11434'},original).key,'');
  assert.equal(publicConfig(original).key,undefined);
});
test('local config survives reload, excludes group/other read permissions and supports clearing',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-model-'));
  try{
    const file=path.join(dir,'data','ai-config.json');
    assert.equal(await readConfig(file,original),original);
    await writeConfig(file,original);
    assert.equal((await readConfig(file,{})).key,original.key);
    assert.equal((await stat(file)).mode&0o777,0o600);
    const cleared=candidate({...original,key:'',clearKey:true},original);
    await writeConfig(file,cleared);assert.equal((await readConfig(file,{})).enabled,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('configuration rejects forwarded or non-local requests',()=>{
  const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:5173'}};
  assert.equal(isLocalConfigRequest(request,5173),true);
  assert.equal(isLocalConfigRequest({...request,headers:{host:'remote.example.test'}},5173),false);
  assert.equal(isLocalConfigRequest({...request,headers:{...request.headers,'x-forwarded-for':'1.2.3.4'}},5173),false);
  assert.equal(isLocalConfigRequest({...request,socket:{remoteAddress:'192.168.1.2'}},5173),false);
});

test('legacy config migrates without overwriting; multiple keys and active selection survive reload',async()=>{
  const {readStore,writeStore,changeStore,activeConfig,publicStore}=await import('./model-config.mjs');
  const {readFile}=await import('node:fs/promises');
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-providers-'));
  try{
    const file=path.join(dir,'config.json');await writeConfig(file,original);
    const before=await readFile(file,'utf8');let store=await readStore(file,{});
    assert.equal(await readFile(file,'utf8'),before);
    const first=store.activeId;assert.equal(activeConfig(store).key,'private-key');
    store=changeStore(store,{...original,action:'save',name:'Second',key:'second-key'});
    const second=store.providers[1].id;assert.equal(store.activeId,first);
    assert.equal(store.providers[0].key,'private-key');
    assert.throws(()=>changeStore(store,{...original,key:'',action:'save',name:'Third'}),/API Key/);
    const publicText=JSON.stringify(publicStore(store));
    assert.equal(publicText.includes('private-key'),false);assert.equal(publicText.includes('second-key'),false);
    store=changeStore(store,{action:'activate',id:second});await writeStore(file,store);
    store=await readStore(file,{});assert.equal(activeConfig(store).key,'second-key');
    assert.equal((await stat(file)).mode&0o777,0o600);
    const deletedActive=changeStore(store,{action:'delete',id:second});assert.equal(deletedActive.activeId,null);assert.equal(deletedActive.providers.length,1);
    assert.throws(()=>changeStore(store,{...original,action:'save',name:'Second',id:second,base:'https://another.test',key:''}),/重新填写/);
    store=changeStore(store,{action:'delete',id:first});assert.equal(store.providers.length,1);
    const cleared=changeStore(store,{...original,id:second,name:'Second',action:'save',key:'',clearKey:true});
    assert.equal(activeConfig(cleared).enabled,false);
    assert.throws(()=>changeStore(cleared,{action:'activate',id:second}),/完善/);
    await writeStore(file,cleared);assert.equal(activeConfig(await readStore(file,{})).enabled,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('empty store and rejected changes preserve configuration',async()=>{
  const {readStore,writeStore,changeStore,activeConfig}=await import('./model-config.mjs');
  const {config}=await import('./ai.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-empty-'));
  try{
    const file=path.join(dir,'config.json');const empty=await readStore(file,config({}));
    assert.deepEqual(empty,{version:2,activeId:null,providers:[]});assert.equal(activeConfig(empty).enabled,false);
    let store=changeStore(empty,{action:'save',name:'Local',provider:'ollama',base:'http://127.0.0.1:11434',model:'qwen3:8b',activate:true});
    await writeStore(file,store);assert.equal((await readStore(file,{})).activeId,store.activeId);
    const snapshot=JSON.stringify(store);
    assert.throws(()=>changeStore(store,{action:'activate',id:'missing'}),/不存在/);
    assert.throws(()=>changeStore(store,{action:'save',name:''}),/名称/);
    await assert.rejects(writeStore(dir,store));
    assert.equal(JSON.stringify(store),snapshot);
    assert.equal((await readStore(file,{})).activeId,store.activeId);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('deleting the last active provider disables AI instead of retaining its credentials',async()=>{
  const {changeStore,activeConfig}=await import('./model-config.mjs');
  const store=changeStore({version:2,providers:[],activeId:null},{action:'save',name:'Local',provider:'ollama',base:'http://127.0.0.1:11434',model:'demo',activate:true});
  assert.throws(()=>changeStore(store,{action:'save',name:'local',provider:'ollama',base:'http://127.0.0.1:11434',model:'demo'}),/已存在/);
  const empty=changeStore(store,{action:'delete',id:store.activeId});
  assert.equal(empty.providers.length,0);assert.equal(empty.activeId,null);assert.equal(activeConfig(empty).enabled,false);
});

test('analysis timeout defaults, validates, persists and is retained on older-client edits',async()=>{
  const {changeStore,writeStore,readStore,publicStore}=await import('./model-config.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'paytrace-timeout-'));
  try{
    assert.equal(candidate(original).timeoutSeconds,300);
    for(const timeoutSeconds of [0,29,3601,60.5,'invalid',''])assert.throws(()=>candidate({...original,timeoutSeconds}),/30–3600/);
    let store=changeStore({version:2,activeId:null,providers:[]},{...original,action:'save',name:'Slow model',timeoutSeconds:900,activate:true});
    store=changeStore(store,{...original,id:store.activeId,action:'save',name:'Slow model',key:''});
    const file=path.join(dir,'config.json');await writeStore(file,store);
    const restored=await readStore(file,{});
    assert.equal(restored.providers[0].timeoutSeconds,900);
    assert.equal(restored.providers[0].key,original.key);
    assert.equal(publicStore(restored).providers[0].timeoutSeconds,900);
  }finally{await rm(dir,{recursive:true,force:true})}
});
