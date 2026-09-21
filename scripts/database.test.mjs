import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {readDatabaseConfig,secretCodec} from './database.mjs';
import {passwordHash,verifyPassword,knowledgeInput,reportInput,bodyJson} from './mysql-api.mjs';
import {exportSeed,sqlLiteral} from './export-mysql-seed.mjs';
import {readMysqlStore,writeMysqlStore} from './mysql-store.mjs';
const codec=secretCodec('11'.repeat(32));
test('credentials use authenticated encryption; tampering and the wrong key are rejected',()=>{
  const value='fixture-password';const cipher=codec.encrypt(value);
  assert.equal(codec.decrypt(cipher),value);assert.notEqual(codec.encrypt(value),cipher);assert.ok(!cipher.includes(value));
  assert.throws(()=>secretCodec('22'.repeat(32)).decrypt(cipher));
  const tampered=Buffer.from(cipher,'base64');tampered[28]^=1;assert.throws(()=>codec.decrypt(tampered.toString('base64')));
});
test('password verification uses salted scrypt and rejects wrong passwords',async()=>{
  const hash=await passwordHash('fixture-password');assert.ok(!hash.includes('fixture-password'));assert.equal(await verifyPassword('fixture-password',hash),true);assert.equal(await verifyPassword('wrong',hash),false);assert.notEqual(hash,await passwordHash('fixture-password'));
});
test('config explicitly selects mode; malformed mysql cannot fall back to browser storage',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'paytrace-config-')),file=path.join(dir,'database.json');
  await writeFile(file,JSON.stringify({driver:'local'}));assert.equal((await readDatabaseConfig(file)).driver,'local');
  await writeFile(file,JSON.stringify({driver:'mysql',password:'do-not-display'}));await assert.rejects(readDatabaseConfig(file),e=>!e.message.includes('do-not-display')&&e.message.includes('配置无效'));
  await assert.rejects(readDatabaseConfig(path.join(dir,'missing.json')),/配置无法读取/);
  await writeFile(file,'{');await assert.rejects(readDatabaseConfig(file),/配置无法读取/);
});
test('SQL exporter is additive, handles quotes and backslashes, and encrypts saved secrets',async()=>{
  const source={id:'fixture',workspace:'card',name:"O'Reilly\\\n",password:'fixture-password'};
  const sql=await exportSeed({sources:{sources:[source]},projects:{projects:[]},models:{providers:[],activeId:null},codec});
  assert.ok(sql.includes('ON DUPLICATE KEY UPDATE id=id'));assert.ok(!sql.includes('fixture-password'));assert.ok(!sql.includes("O'Reilly"));assert.ok(!/\b(?:DROP|DELETE|TRUNCATE)\b/.test(sql));
  assert.equal(sqlLiteral(''),"''");assert.equal(sqlLiteral(null),'NULL');
  assert.ok(sql.includes("SET time_zone = '+08:00';"));assert.ok(sql.includes('SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;'));
});
test('request and report validation rejects oversized input and workspace confusion',async()=>{
  await assert.rejects(bodyJson((async function*(){yield Buffer.alloc(20)})(),10),e=>e.status===413);
  await assert.rejects(bodyJson((async function*(){yield Buffer.from('{')})()),/JSON/);
  assert.throws(()=>knowledgeInput({scanEnabled:true,projects:[],markdown:''}),/项目/);
  assert.equal(knowledgeInput({scanEnabled:false,projects:[],markdown:''}).markdown,'');
  assert.throws(()=>reportInput({kind:'real',workspaceId:'hk-cb'},'card'),/格式/);
});
test('store adapter binds secrets and updates model selection in the same transaction',async()=>{
  const calls=[];let committed=false;const db={codec,transaction:async fn=>{await fn({execute:async(sql,params)=>{calls.push({sql,params});return [[]]}});committed=true}};
  await writeMysqlStore(db,'models',{activeId:'m1',providers:[{id:'m1',name:'fixture',key:'fixture-secret',enabled:true}]});
  assert.equal(committed,true);const insert=calls.find(c=>c.sql.startsWith('INSERT'));
  assert.ok(!insert.params[2].includes('fixture-secret'));assert.equal(codec.decrypt(insert.params[3]),'fixture-secret');assert.equal(calls.at(-1).params[0],'m1');
  const readDb={codec,pool:{execute:async sql=>sql.includes('app_settings')?[[{active_model_id:'m1'}]]:[[{payload:JSON.parse(insert.params[2]),secret_cipher:insert.params[3]}]]}};
  assert.equal((await readMysqlStore(readDb,'models')).providers[0].key,'fixture-secret');
  await assert.rejects(writeMysqlStore(db,'models; DROP TABLE users',{}),/类型/);
});
test('mysql browser uses server workspaces and APIs without rewriting legacy localStorage',async()=>{
  const responses=[];const requests=[];let writes=0;
  const node={append(){},prepend(){}};
  const window={workspaceCatalog:[{id:'card',name:'旧空间'}],workspaceData:{get:id=>window.workspaceCatalog.find(w=>w.id===id)}};
  const context=vm.createContext({window,localStorage:{getItem:()=>null,setItem(){writes++}},document:{createElement:()=>({...node}),querySelector:()=>node},location:{},AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>responses.shift()}},alert(){}});
  vm.runInContext(await readFile(new URL('../frontend/mysql-browser.js',import.meta.url),'utf8'),context);
  responses.push({workspaces:[{id:'card',name:'数据库空间'}]});await window.initializeMysqlBrowser();assert.equal(window.workspaceCatalog[0].name,'数据库空间');
  responses.push({markdown:'saved'});assert.equal((await window.localApi('/knowledge','PUT',{markdown:'saved'},'card')).markdown,'saved');assert.equal(requests.at(-1).url,'/api/data/knowledge?workspace=card');assert.equal(requests.at(-1).options.method,'PUT');assert.equal(writes,0);
});
