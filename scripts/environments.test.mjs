import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {requestEnvironment,requireWorkspaceEnvironment} from './environments.mjs';
import {mysqlApi} from './mysql-api.mjs';

test('environment is a per-request selection; fixed production cannot switch to test',()=>{
  const request=value=>({headers:value?{'x-paytrace-environment':value}:{}});
  assert.equal(requestEnvironment(request()),'test');
  assert.equal(requestEnvironment(request('production'),{switchable:true}),'production');
  assert.equal(requestEnvironment(request('test'),{switchable:true}),'test');
  assert.throws(()=>requestEnvironment(request('production')),e=>e.status===409);
  assert.throws(()=>requestEnvironment(request('test'),{defaultEnvironment:'production'}),e=>e.status===409);
  assert.throws(()=>requestEnvironment(request('invalid'),{switchable:true}),e=>e.status===400);
});

test('cross-environment workspace IDs are rejected before accessing configuration or reports',async()=>{
  const execute=async(sql,args=[])=>{
    if(sql==='SELECT id FROM app_settings WHERE id=1 FOR UPDATE')return [[]];
    if(sql.includes('FROM workspaces'))return [args.includes('production')?[]:[{id:'card'}]];
    throw Error('must not access data from a rejected workspace');
  };
  const db={environmentSupport:true,pool:{execute},transaction:fn=>fn({execute})};
  await requireWorkspaceEnvironment(db,'card','test');
  await assert.rejects(requireWorkspaceEnvironment(db,'card','production'),e=>e.status===404);
  const api=mysqlApi(db);
  for(const route of ['/api/data/knowledge','/api/data/investigations','/api/data/investigations/fixture','/api/workspaces/delete']){
    await assert.rejects(api.handle(route,'GET',null,'card',{},'production'),e=>e.status===404);
  }
  await assert.rejects(api.handle('/api/workspaces','POST',{id:'card',name:'wrong environment'},null,{},'production'),e=>e.status===404);
  await assert.rejects(api.handle('/api/import/browser','POST',{workspaces:[]},null,{},'production'),e=>e.status===403);
});

test('browser pins environment for the lifetime of a page and does not send it to external services',async()=>{
  const requests=[],storage=new Map([['paytrace.environment','production']]);let reloads=0;
  const window={fetch:async(input,options)=>{requests.push({input,options});return {ok:true}}};
  const context=vm.createContext({window,URL,Headers,location:{href:'http://127.0.0.1:19527/',origin:'http://127.0.0.1:19527',reload(){reloads++}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},alert(){}});
  vm.runInContext(await readFile(new URL('../frontend/environment.js',import.meta.url),'utf8'),context);
  await window.fetch('/api/workspaces');assert.equal(requests.at(-1).options.headers.get('X-PayTrace-Environment'),'production');
  window.paytraceEnvironment.switchTo('test');assert.equal(reloads,1);
  await window.fetch('/api/data/investigations');assert.equal(requests.at(-1).options.headers.get('X-PayTrace-Environment'),'production');
  await window.fetch('https://example.com/api/anything');assert.equal(requests.at(-1).options.headers,undefined);
  window.paytraceEnvironment.reset();await window.fetch('/api/workspaces');assert.equal(requests.at(-1).options.headers,undefined);
});
