import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('restored task is observed without resubmission; leaving scope does not cancel; stop targets the server task',async()=>{
  const nodes=new Map(),calls=[],timers=new Map();let timerId=0;
  const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',checked:false,hidden:false,disabled:false,innerHTML:'',textContent:'',addEventListener(){},querySelectorAll(){return []},replaceChildren(){},append(){}});return nodes.get(key)};
  const project={id:'p',name:'fixture',scanEnabled:false,task:{id:'task',status:'running',startedAt:new Date().toISOString(),stages:['接收中'],message:'接收中',received:120}};
  const context=vm.createContext({
    window:{},document:{getElementById:key=>node('#'+key)},$:node,workspaceId:'card',activeWorkspace:{name:'fixture'},location:{protocol:'http:'},AbortSignal,Date,esc:String,
    setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout(id){timers.delete(id)},
    fetch:async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):null});if(options.body){project.task.status='cancelled';return {ok:true,json:async()=>({task:project.task})}}return {ok:true,json:async()=>({projects:[structuredClone(project)]})}},
  });
  vm.runInContext(await readFile(new URL('../frontend/project-settings.js',import.meta.url),'utf8'),context);
  await new Promise(r=>setImmediate(r));await context.window.loadProjectSettings();
  assert.match(node('#project-analysis-count').textContent,/120/);assert.equal(node('#stop-project-analysis').disabled,false);
  context.window.cancelProjectAnalysis();
  assert.equal(calls.filter(c=>c.body).length,0);assert.equal(timers.size,0);
  await context.window.loadProjectSettings();
  assert.equal(calls.filter(c=>c.body).length,0);
  await node('#stop-project-analysis').onclick();
  assert.deepEqual(calls.find(c=>c.body).body,{action:'cancel',workspace:'card',id:'p',taskId:'task'});
  assert.equal(node('#stop-project-analysis').disabled,true);
});
