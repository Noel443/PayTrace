import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import '../frontend/stream.js';

test('HTTP task creation, disconnected observation, restart recovery, isolation, cancellation and long text',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'paytrace-http-'));
  await writeFile(path.join(dir,'database.json'),JSON.stringify({driver:'local'}));
  await writeFile(path.join(dir,'empty.env'),'');
  const pending=[];let ordinaryMessages;
  const model=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
    if(body.messages[0].content.includes('业务分析师'))pending.push(res);
    else{
      ordinaryMessages=body.messages;
      res.end('data: '+JSON.stringify({choices:[{delta:{content:'分析结果'.repeat(10000)},finish_reason:'stop'}]})+'\n\n');
    }
  });
  model.listen(0,'127.0.0.1');await once(model,'listening');
  t.after(()=>{model.closeAllConnections();model.close()});
  await writeFile(path.join(dir,'models.json'),JSON.stringify({version:2,activeId:'fixture',providers:[{id:'fixture',name:'mock',provider:'compatible',base:'http://127.0.0.1:'+model.address().port,model:'fixture',key:'fixture',timeoutSeconds:300}]}));
  let child,base;
  async function boot(){
    child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',PUBLIC_ORIGINS:'',PAYTRACE_ENV:'test',PAYTRACE_ENV_FILE:path.join(dir,'empty.env'),DATABASE_CONFIG_FILE:path.join(dir,'database.json'),AI_CONFIG_FILE:path.join(dir,'models.json'),PROJECTS_FILE:path.join(dir,'projects.json'),LOG_SOURCES_FILE:path.join(dir,'sources.json')}});
    let stdout='',stderr='';
    child.stderr.on('data',b=>stderr+=b);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('server startup timeout '+stderr)),5000);
      child.stdout.on('data',b=>{stdout+=b;const m=stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){base=m[0];clearTimeout(timer);resolve()}});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited '+stderr))});
    });
  }
  async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended}}
  t.after(stop);
  // Only loopback fixture traffic and temporary JSON stores are used.
  await boot();
  const request=async(body,scope='card')=>{
    const r=await fetch(base+'/api/projects'+(body?'':'?workspace='+scope),body?{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    return {status:r.status,...await r.json()};
  };
  const saved=await request({action:'save',workspace:'card',name:'fixture',scanEnabled:false});
  assert.equal(saved.status,200);const id=saved.projects[0].id;
  const start=()=>request({action:'analyze',workspace:'card',id,markdown:'# fixture'});
  const task=await start();assert.equal(task.status,202);assert.ok(task.task.id);
  assert.equal((await start()).task.id,task.task.id);
  assert.equal((await request(null,'hk-cb')).projects.length,0);
  assert.equal((await request({action:'cancel',workspace:'hk-cb',id,taskId:task.task.id})).status,400);
  const watch=await fetch(base+'/api/projects?workspace=card');await watch.body.cancel();
  await new Promise(r=>setTimeout(r,50));
  assert.equal((await request()).projects[0].task.status,'running');
  await stop();await boot();
  assert.equal((await request()).projects[0].task.status,'interrupted');
  const retried=await start();assert.notEqual(retried.task.id,task.task.id);
  await request({action:'cancel',workspace:'card',id,taskId:retried.task.id});
  assert.equal((await request()).projects[0].task.status,'cancelled');
  const question='用户粘贴日志材料\n'.repeat(2000);
  const response=await fetch(base+'/api/investigations/stream',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({workspace:'card',question,markdown:''})});
  let report;
  await PayTraceStream.readEvents(response,'sse',({event,data})=>{if(event==='error')assert.fail(data);if(event==='done')report=JSON.parse(data).report});
  assert.equal(report.question,question.trim());assert.equal(report.evidence.length,0);assert.equal(report.ai.text.length,40000);
  assert.equal(JSON.parse(ordinaryMessages[1].content).question,question.trim());
  const follow=await fetch(base+'/api/investigations/followup/stream',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({workspace:'card',reportId:report.id,report,question,markdown:'',expectedCount:0,revision:0})});
  let turn;await PayTraceStream.readEvents(follow,'sse',({event,data})=>{if(event==='error')assert.fail(data);if(event==='done')turn=JSON.parse(data).turn});
  assert.equal(turn.question,question.trim());assert.equal(turn.text.length,40000);
  const tooLarge=await fetch(base+'/api/investigations/stream',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({workspace:'card',question:'x'.repeat(200001),markdown:''})});
  assert.match(await tooLarge.text(),/过长/);
});
