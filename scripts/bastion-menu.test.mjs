import test from 'node:test';
import assert from 'node:assert/strict';
import {menuSession} from './bastion-menu.mjs';
import {sourceCandidate,publicSources} from './log-sources.mjs';
const source={workspace:'card',name:'menu',service:'trx',host:'47.115.138.226',port:22,username:'log_user',password:'private',environment:'生产',logPath:'app.log',logDirectory:'/logs',enabled:true,connectionMode:'menu',jumpHost:'172.16.35.111',jumpPort:60022,jumpUsername:'liuyuhao',jumpPassword:'bastion-private'};
function fixture(options={}){
  const writes=[];let result,error;
  const receive=menuSession(source,'exit 41',{write:s=>writes.push(s),complete:(...r)=>result=r,fail:e=>error=e,...options});
  receive(Buffer.from('[usm'));assert.equal(writes.length,0);receive(Buffer.from('shell]\n001: menu 47.115.138.226:22 ssh log_user\n'));
  assert.equal(writes[0],':');receive(Buffer.from(':'));
  assert.equal(writes[1],'ssh log_user@47.115.138.226:22\r');
  return {receive,writes,get result(){return result},get error(){return error}};
}
test('menu waits for shell and framed completion, ignores echo and preserves split UTF8',()=>{
  const f=fixture();f.receive(Buffer.from('Last login\n-bash-4.2$ '));assert.equal(f.writes.length,3);
  const token=f.writes[2].match(/PT_BEGIN_' '([a-f0-9]+)'/)[1];
  f.receive(Buffer.from(f.writes[2]));assert.equal(f.result,undefined);
  const output=Buffer.from(`\r\nPT_BEGIN_${token}\r\n中文日志\r\nPT_END_${token}:41\r\n`);
  for(const byte of output)f.receive(Buffer.from([byte]));
  assert.equal(f.result[0],41);assert.equal(f.result[1].toString(),'中文日志');
});
test('menu refuses second authentication and does not send log command',()=>{
  const f=fixture();f.receive(Buffer.from('Password: '));assert.match(f.error.message,/二次认证/);assert.equal(f.writes.length,2);
});
test('menu types the direct SSH command without selecting an asset row',()=>{
  const writes=[];
  const receive=menuSession({...source,name:'anything'},'exit 41',{write:s=>writes.push(s),complete:()=>{},fail:e=>{throw e}});
  receive(Buffer.from('[usmshell]\n008: kj-trx01 192.168.20.39:22 ssh log_user\n'));
  assert.deepEqual(writes,[':']);receive(Buffer.from(':'));assert.deepEqual(writes,[':','ssh log_user@47.115.138.226:22\r']);
  receive(Buffer.from('still waiting for target'));
  assert.equal(writes.length,2);
});
test('USM failure never dispatches a log command',()=>{
  const f=fixture();
  f.receive(Buffer.from("[USM] 'gate-token-usmshell' is unavailable, sorry ..."));
  assert.match(f.error.message,/目标会话未建立/);
  assert.equal(f.writes.length,2);
});
test('menu credentials are private and cannot be reused after changing bastion identity',()=>{
  const saved=sourceCandidate(source);assert.equal(saved.connectionMode,'menu');
  assert.equal(publicSources({sources:[saved]},'card')[0].password,undefined);
  assert.equal(sourceCandidate({...source,password:''},saved).password,'private');
  assert.throws(()=>sourceCandidate({...source,password:'',jumpPassword:'',jumpUsername:'different'},saved),/堡垒机 SSH 密码/);
  assert.throws(()=>sourceCandidate({...source,connectionMode:'unknown'}),/连接方式/);
  assert.throws(()=>sourceCandidate({...source,username:'user;id'}),/账号/);
});
