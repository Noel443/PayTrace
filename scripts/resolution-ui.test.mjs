import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../frontend/resolution-ui.js',import.meta.url),'utf8'),context);
const ui=vm.runInContext('PayTraceResolution',context);
function setup(feedback, options={}) {
  const element=()=>({value:'',textContent:'',disabled:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;}});
  const elements=new Map();
  const find=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const cards=['已解决','需要开发介入','判断不正确'].map(status=>({...element(),dataset:{resolution:status}}));
  const panel={querySelector:find,querySelectorAll:()=>cards};
  const note=find('#real-note');note.value=feedback?.note||'';
  let retries=0,saves=0;
  const controller=ui.bind(panel,{feedback},{
    save:async body=>{saves++;return {feedback:{...body,time:'2026-09-23T00:00:00Z'}};},
    onSaved:()=>{},retry:()=>retries++,...options
  });
  return {find,cards,note,controller,get retries(){return retries;},get saves(){return saves;}};
}
test('cards guide each outcome, preserve notes, and append the matching outline',()=>{
  const s=setup();
  assert.equal(s.find('#real-save').disabled,true);
  assert.match(s.find('#resolution-save-state').textContent,/未保存/);
  s.note.value='已核实内容';s.note.oninput();
  const labels=['解决情况','研发接手信息','判断修正说明'];
  s.cards.forEach((card,index)=>{
    card.onclick();
    assert.match(s.find('#resolution-note-label').textContent,new RegExp(labels[index]));
    assert.equal(s.cards.filter(c=>c.attributes['aria-pressed']==='true').length,1);
    assert(s.note.value.startsWith('已核实内容'));
    s.find('#resolution-outline').onclick();
    assert(s.note.value.includes(s.note.placeholder));
  });
  assert.match(s.note.value,/需要研发确认或处理/);
});
test('outline refuses overflow without truncation; saved notes are escaped',()=>{
  const s=setup();s.cards[0].onclick();s.note.value='字'.repeat(2000);s.note.oninput();
  s.find('#resolution-outline').onclick();
  assert.equal(s.note.value.length,2000);
  assert.match(s.find('#resolution-save-state').textContent,/超过 2000/);
  const html=ui.render({feedback:{note:'</textarea><script>alert(1)</script>'}});
  assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
  assert(html.includes('需要研发介入'));assert(html.includes('当前报告及已保存的反馈会保留'));
});
test('retry requires saved edits, success keeps the panel and unchanged feedback is saved',async()=>{
  const s=setup();s.cards[1].onclick();
  s.find('#real-retry').onclick();assert.equal(s.retries,0);
  await s.find('#real-save').onclick();
  assert.equal(s.saves,1);assert.match(s.find('#resolution-save-state').textContent,/^已保存/);
  assert.equal(s.find('#real-save').disabled,true);
  assert.equal(s.controller.getDraft().status,'需要开发介入');
  s.find('#real-retry').onclick();assert.equal(s.retries,1);
  s.note.value='新说明';s.note.oninput();assert.match(s.find('#resolution-save-state').textContent,/未保存/);
  s.note.value='';s.note.oninput();assert.match(s.find('#resolution-save-state').textContent,/^已保存/);
});
test('failure keeps input and allows retry; concurrent submission is suppressed',async()=>{
  let rejectSave,calls=0;
  const s=setup(undefined,{save:body=>{calls++;return calls===1?new Promise((_,reject)=>{rejectSave=reject;}):Promise.resolve({feedback:body});}});
  s.cards[2].onclick();s.note.value='证据 E1 与判断不符';s.note.oninput();
  const saving=s.find('#real-save').onclick();
  assert.equal(s.note.disabled,true);assert.equal(s.find('#real-retry').disabled,true);
  await s.find('#real-save').onclick();assert.equal(calls,1);
  rejectSave(Error('存储不可用'));await saving;
  assert.match(s.find('#resolution-save-state').textContent,/未保存 · 保存失败/);
  assert.equal(s.note.value,'证据 E1 与判断不符');assert.equal(s.find('#real-save').disabled,false);
  await s.find('#real-save').onclick();assert.match(s.find('#resolution-save-state').textContent,/^已保存/);
});
test('followup refresh restores selection and draft against the saved baseline',()=>{
  const feedback={status:'已解决',note:'原有说明'};
  const before=setup(feedback);before.cards[2].onclick();before.note.value='待核实反证';before.note.oninput();
  const after=setup(feedback);after.controller.setDraft(before.controller.getDraft());
  assert.equal(after.cards[2].attributes['aria-pressed'],'true');
  assert.equal(after.note.value,'待核实反证');assert.match(after.find('#resolution-save-state').textContent,/未保存/);
  after.find('#real-retry').onclick();assert.equal(after.retries,0);
});
test('ongoing investigations block feedback writes and retries',async()=>{
  const s=setup(undefined,{isBusy:()=>true});s.cards[0].onclick();
  await s.find('#real-save').onclick();s.find('#real-retry').onclick();
  assert.equal(s.saves,0);assert.equal(s.retries,0);assert.match(s.find('#resolution-save-state').textContent,/等待/);
});
