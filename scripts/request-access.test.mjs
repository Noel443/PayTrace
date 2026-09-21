import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicOrigins,requestAccess} from './request-access.mjs';

const origin='https://tunnel.example.test';
const request=(headers={},remoteAddress='127.0.0.1')=>({headers:{host:'localhost:19527',...headers},socket:{remoteAddress}});
test('public origins are explicit and require server authentication',()=>{
  assert.deepEqual(parsePublicOrigins(),[]);
  assert.deepEqual(parsePublicOrigins(`${origin},http://tunnel.example.test:8080,${origin}`),[origin,'http://tunnel.example.test:8080']);
  for(const value of ['*','https://*.example.test',origin+'/',origin+'/path',origin+'?q=1',origin+'#fragment','https://user:pass@example.test','ftp://example.test',origin+','])assert.throws(()=>parsePublicOrigins(value));
  assert.throws(()=>requestAccess({port:19527,publicOrigins:[origin]}),/MySQL/);
});
test('default local access rejects proxies, remote sockets and foreign origins',()=>{
  const access=requestAccess({port:19527});
  assert.equal(access.allowed(request()),true);
  assert.equal(access.allowed(request({'x-forwarded-for':'203.0.113.5'})),false);
  assert.equal(access.allowed(request({},'192.168.1.2')),false);
  assert.equal(access.allowed(request({host:'tunnel.example.test'})),false);
  assert.equal(access.sameOrigin(request({origin:'http://localhost:19527'})),true);
  assert.equal(access.sameOrigin(request({origin})),false);
});
test('NATAPP accepts exact hosts and origins, never trusts forwarded hosts',()=>{
  const access=requestAccess({port:19527,publicOrigins:parsePublicOrigins(origin+',http://second.example.test'),authenticated:true});
  const headers={host:'tunnel.example.test',origin,'x-forwarded-for':'203.0.113.5','x-forwarded-host':'untrusted.example.test','x-forwarded-proto':'http'};
  assert.equal(access.allowed(request(headers)),true);
  assert.equal(access.sameOrigin(request(headers)),true);
  assert.equal(access.allowed(request(headers,'203.0.113.5')),false);
  for(const host of ['unknown.example.test','tunnel.example.test.evil.test','tunnel.example.test:8080','localhost:19527'])assert.equal(access.allowed(request({...headers,host,'x-forwarded-host':'tunnel.example.test'})),false);
  for(const value of [undefined,'null','http://tunnel.example.test','http://second.example.test',origin+'/','https://evil.example.test'])assert.equal(access.sameOrigin(request({...headers,origin:value})),false);
  assert.equal(access.sameOrigin(request({host:'second.example.test',origin:'http://second.example.test'})),true);
});
