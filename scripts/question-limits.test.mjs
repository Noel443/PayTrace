import test from 'node:test';
import assert from 'node:assert/strict';
import '../frontend/limits.js';
test('oversized paste is rejected visibly instead of silently inserting a truncated question',()=>{
  const events={};let prevented=false,reported=false;
  const input={value:'old text',selectionStart:0,selectionEnd:0,addEventListener:(name,fn)=>events[name]=fn,setCustomValidity(value){this.message=value},reportValidity(){reported=true}};
  PayTraceQuestionInput(input);
  assert.equal(input.maxLength,200000);
  events.paste({clipboardData:{getData:()=> 'x'.repeat(200000)},preventDefault(){prevented=true}});
  assert(prevented&&reported);assert.match(input.message,/未插入/);assert.equal(input.value,'old text');
  events.paste({clipboardData:{getData:()=> 'x'.repeat(12000)},preventDefault(){assert.fail('long legal paste rejected')}});
  assert.equal(input.message,'');
});
