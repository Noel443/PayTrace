// Opt-in MySQL 8 integration: creates a new isolated database, never deletes an existing one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {createConnection} from 'mysql2/promise';
import {readDatabaseConfig,openDatabase} from './database.mjs';
import {mysqlApi} from './mysql-api.mjs';
import {writeMysqlStore,readMysqlStore} from './mysql-store.mjs';
const enabled=!!process.env.MYSQL_TEST_CONFIG;
test('MySQL 8 schema, seed, persistence, transactions, isolation, encryption and HTTP sessions',{skip:!enabled,timeout:60000},async()=>{
  const config=await readDatabaseConfig(process.env.MYSQL_TEST_CONFIG);
  const database='paytrace_test_'+Date.now()+'_'+randomBytes(3).toString('hex');
  const admin=await createConnection({host:config.host,port:config.port,user:config.user,password:config.password,multipleStatements:true});
  let db,child;
  try{
    const [[version]]=await admin.query('SELECT VERSION() AS version');assert.match(version.version,/^8\./,'Requires MySQL 8.x');
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.changeUser({database});
    const files=['20260921000100_initial_schema.sql','20260921000200_initial_data.sql'];
    for(let run=0;run<2;run++)for(const file of files)await admin.query(await readFile(new URL('../sql/'+file,import.meta.url),'utf8'));
    const [[count]]=await admin.query('SELECT COUNT(*) AS n FROM workspaces');assert.equal(count.n,3);
    const testConfig={...config,driver:'mysql',database,encryptionKey:randomBytes(32).toString('hex')};
    db=await openDatabase(testConfig);const api=mysqlApi(db),actor={id:'00000000-0000-4000-8000-000000000001'};
    const [[connection]]=await db.pool.query('SELECT @@session.time_zone AS zone, @@character_set_connection AS charset, @@collation_connection AS collation, TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),CURRENT_TIMESTAMP) AS offsetSeconds');
    assert.equal(connection.zone,'+08:00');assert.equal(connection.charset,'utf8mb4');assert.equal(connection.collation,'utf8mb4_0900_ai_ci');assert.equal(connection.offsetSeconds,28800);
    await assert.rejects(openDatabase(testConfig),/只运行一个/);
    const report={id:'report-fixture',kind:'real',workspaceId:'card',transaction:{id:'fixture-txn'},revision:0,evidence:[],coverage:[],ai:{status:'disabled',text:'fixture'},createdAt:'2026-09-21T00:00:00Z'};
    await api.handle('/api/data/investigations','POST',report,'card',actor);
    const [[reportTime]]=await db.pool.execute("SELECT created_at,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS storedTime FROM investigations WHERE id=?",[report.id]);
    assert.equal(reportTime.storedTime,'2026-09-21 08:00:00');assert.equal(reportTime.created_at.toISOString(),new Date(report.createdAt).toISOString());
    await api.handle('/api/data/investigations/report-fixture/feedback','POST',{status:'已解决',note:'saved'},'card',actor);
    await api.handle('/api/data/investigations','POST',report,'card',actor);
    assert.equal((await api.handle('/api/data/investigations/report-fixture','GET',null,'card',actor)).feedback.note,'saved');
    await assert.rejects(api.handle('/api/data/investigations/report-fixture','GET',null,'hk-cb',actor),e=>e.status===404);
    const followupUpdate={turn:{id:'turn-fixture',question:'下一步？',text:'请补齐日志 [E1]',model:'fixture',createdAt:new Date().toISOString()},expectedCount:0,revision:0};
    await api.handle('/api/data/investigations/report-fixture/followups','POST',followupUpdate,'card',actor);
    await api.handle('/api/data/investigations/report-fixture/followups','POST',followupUpdate,'card',actor);
    const withConversation=await api.handle('/api/data/investigations/report-fixture','GET',null,'card',actor);
    assert.equal(withConversation.followups.length,1);assert.equal(withConversation.feedback.note,'saved');
    await assert.rejects(api.handle('/api/data/investigations/report-fixture/followups','POST',{...followupUpdate,turn:{...followupUpdate.turn,id:'stale-turn'}},'card',actor),e=>e.status===409);
    await assert.rejects(api.handle('/api/data/investigations/report-fixture/followups','POST',followupUpdate,'hk-cb',actor),e=>e.status===404);

    await assert.rejects(api.handle('/api/data/investigations','DELETE',{ids:['report-fixture','missing']},'card',actor),e=>e.status===409);
    assert.equal((await api.handle('/api/data/investigations','GET',null,'card',actor)).length,1,'partial bulk deletion rolls back');
    await api.handle('/api/data/knowledge','PUT',{scanEnabled:false,projects:[],markdown:''},'card',actor);
    await api.handle('/api/import/browser','POST',{workspaces:[{workspace:{id:'card',name:'legacy'},knowledge:{scanEnabled:false,projects:[],markdown:'must not overwrite blank'},reports:[]}]},null,actor);
    assert.equal((await api.handle('/api/data/knowledge','GET',null,'card',actor)).markdown,'');
    await assert.rejects(api.handle('/api/data/investigations/report-fixture/ai','POST',{status:'completed',text:'stale',revision:9},'card',actor),e=>e.status===409);
    await writeMysqlStore(db,'models',{activeId:'m1',providers:[{id:'m1',name:'fixture',provider:'compatible',base:'http://127.0.0.1:1/v1',model:'fixture',enabled:true,key:'fixture-secret'}]});
    const [[model]]=await admin.query('SELECT payload,secret_cipher FROM model_providers');assert.ok(!JSON.stringify(model).includes('fixture-secret'));assert.equal((await readMysqlStore(db,'models')).providers[0].key,'fixture-secret');
    const [[times]]=await admin.query('SELECT created_at,updated_at FROM investigations');assert.ok(times.created_at&&times.updated_at);
    await assert.rejects(admin.execute("INSERT INTO projects(id,workspace_id,name,payload) VALUES('bad','missing','fixture',JSON_OBJECT())"),e=>e.code==='ER_NO_REFERENCED_ROW_2');
    const w=(await api.handle('/api/workspaces','POST',{name:'临时空间'},null,actor)).workspace;
    await api.handle('/api/workspaces/delete','POST',{},w.id,actor);
    const [[archived]]=await admin.execute('SELECT deleted_at FROM workspaces WHERE id=?',[w.id]);assert.ok(archived.deleted_at);
    await db.close();db=null;
    // Restart using the same isolated DB, then exercise real HTTP auth and access checks.
    const dir=await mkdtemp(path.join(tmpdir(),'paytrace-mysql-http-'));const configFile=path.join(dir,'database.json');await writeFile(configFile,JSON.stringify(testConfig),{mode:0o600});
    const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port),DATABASE_CONFIG_FILE:configFile},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('HTTP startup timed out')),10000);child.stdout.on('data',data=>{if(String(data).includes('PayTrace:')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(Error('HTTP startup failed'))})});
    const base='http://127.0.0.1:'+port;
    assert.equal((await fetch(base+'/api/workspaces')).status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const [[sessionTime]]=await admin.query('SELECT TIMESTAMPDIFF(SECOND,CURRENT_TIMESTAMP,expires_at) AS remaining FROM sessions WHERE revoked_at IS NULL');
    assert.ok(sessionTime.remaining>28740&&sessionTime.remaining<=28800,'session expires eight hours from Beijing now');
    const history=await fetch(base+'/api/data/investigations?workspace=card',{headers:{Cookie:cookie}});assert.equal((await history.json())[0].feedback.note,'saved');
    assert.equal((await fetch(base+'/api/workspaces',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    const publicModels=await (await fetch(base+'/api/ai/providers',{headers:{Cookie:cookie}})).text();assert.ok(!publicModels.includes('fixture-secret'));
    await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});
    assert.equal((await fetch(base+'/api/workspaces',{headers:{Cookie:cookie}})).status,401);
    const [[revoked]]=await admin.query('SELECT ABS(TIMESTAMPDIFF(SECOND,revoked_at,CURRENT_TIMESTAMP)) AS elapsed FROM sessions LIMIT 1');assert.ok(revoked.elapsed<60);
    // Simulate legacy UTC dates only inside this isolated fixture database.
    const [dateColumns]=await admin.execute("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND DATA_TYPE='datetime'",[database]);
    const tables=new Map();for(const {tableName,columnName} of dateColumns){assert.match(tableName,/^[a-z_]+$/);assert.match(columnName,/^[a-z_]+$/);if(!tables.has(tableName))tables.set(tableName,[]);tables.get(tableName).push(columnName)}
    const snapshot=async()=>{const result={};for(const table of tables.keys()){const [rows]=await admin.query(`SELECT * FROM ${table}`);result[table]=JSON.stringify(rows)}return result};
    const before=await snapshot();
    for(const [table,columns] of tables)await admin.query(`UPDATE ${table} SET ${columns.map(c=>`${c}=DATE_SUB(${c},INTERVAL 8 HOUR)`).join(',')}`);
    const migration=await readFile(new URL('../sql/20260921000300_legacy_utc_to_beijing.sql',import.meta.url),'utf8');
    for(let run=0;run<2;run++){
      await admin.query(migration);const after=await snapshot();
      for(const table of tables.keys())if(table!=='schema_migrations')assert.equal(after[table],before[table],`${table}: legacy conversion preserves instants, JSON and nullable dates, run ${run}`);
    }
  }finally{
    if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}
    await db?.close();await admin.end();
    console.log('隔离验证库保留供检查：'+database);
  }
});
