import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,config,status} from './ai.mjs';

const input={report:{transaction:{id:'T1'},question:'为什么超时？',evidence:[{id:'E1',service:'trx',text:'event=TIMEOUT',context:'OTHER TRANSACTION'}]},markdown:'# 业务文档'};
test('configuration requires provider, model, address and credentials; status never exposes key',()=>{
  assert.equal(config({}).enabled,false);
  const c=config({AI_MODEL:'demo',AI_BASE_URL:'https://example.test/v1',AI_API_KEY:'secret'});
  assert.equal(c.enabled,true);assert(!JSON.stringify(status(c)).includes('secret'));
  assert.equal(config({AI_PROVIDER:'ollama',AI_MODEL:'local'}).enabled,true);
});
test('compatible API sends evidence and Markdown, excludes adjacent transaction context',async()=>{
  const c=config({AI_MODEL:'demo',AI_BASE_URL:'https://example.test/v1',AI_API_KEY:'secret'});
  const result=await analyze(c,input,async(url,options)=>{
    assert.equal(url,'https://example.test/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer secret');
    const data=JSON.parse(options.body);assert.equal(data.stream,false);assert(data.messages[1].content.includes('业务文档'));assert(!data.messages[1].content.includes('OTHER TRANSACTION'));
    return {ok:true,json:async()=>({choices:[{message:{content:'根据 [E1]，最终状态未知。'}}]})};
  });assert.equal(result.status,'completed');assert(result.text.includes('[E1]'));
});
test('Ollama uses native endpoint without bearer credential',async()=>{
  const result=await analyze(config({AI_PROVIDER:'ollama',AI_MODEL:'local'}),input,async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(options.headers.Authorization,undefined);
    return {ok:true,json:async()=>({message:{content:'需进一步核实。'}})};
  });assert.equal(result.text,'需进一步核实。');
});
test('upstream failures are explained without exposing upstream response or keys',async()=>{
  const c=config({AI_PROVIDER:'ollama',AI_MODEL:'local'});
  await assert.rejects(analyze(c,input,async()=>({ok:false,status:401})),/认证/);
  await assert.rejects(analyze(c,input,async()=>({ok:false,status:429})),/额度/);
  await assert.rejects(analyze(c,input,async()=>{throw Error('secret upstream detail')}),/连接失败/);
  await assert.rejects(analyze(c,input,async()=>({ok:true,json:async()=>({})})),/可用文本/);
});
