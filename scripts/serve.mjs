import http from 'node:http';
import {followup} from './followup.mjs';
import {investigate} from './real-investigation.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadEnv,config,status,analyze,analyzeStream} from './ai.mjs';
import {publicConfig,candidate,readStore,writeStore,activeConfig,publicStore,changeStore,isLocalConfigRequest} from './model-config.mjs';

import {readProjects,writeProjects,changeProjects,publicProjects,analyzeProject} from './projects.mjs';
import {runServerLogs} from './server-logs.mjs';
import {workspaceKey,publicSources,changeSources,readSources,writeSources} from './log-sources.mjs';

import {openDatabase} from './database.mjs';
import {readMysqlStore,writeMysqlStore} from './mysql-store.mjs';
import {mysqlApi,bodyJson,insertReport} from './mysql-api.mjs';
await loadEnv();
const database=await openDatabase();
const persistent=database?mysqlApi(database):null;
const saveSources=(file,value)=>database?writeMysqlStore(database,'sources',value):writeSources(file,value);
const saveProjects=(file,value)=>database?writeMysqlStore(database,'projects',value):writeProjects(file,value);
const saveModels=(file,value)=>database?writeMysqlStore(database,'models',value):writeStore(file,value);
const sourcesFile=process.env.LOG_SOURCES_FILE||fileURLToPath(new URL('../data/log-sources.json',import.meta.url));
let sourceStore=database?await readMysqlStore(database,'sources'):await readSources(sourcesFile),sourcesBusy=false;
const projectsFile=process.env.PROJECTS_FILE||fileURLToPath(new URL('../data/projects.json',import.meta.url));
let projectStore=database?await readMysqlStore(database,'projects'):await readProjects(projectsFile),projectBusy=false;
const knownHostsFile=path.join(path.dirname(sourcesFile),'ssh','known_hosts');
const configFile=process.env.AI_CONFIG_FILE||fileURLToPath(new URL('../data/ai-config.json',import.meta.url));
let modelStore=database?await readMysqlStore(database,'models'):await readStore(configFile,config());
let aiConfig=activeConfig(modelStore);
let configBusy=false;
let active=0;
const attempts=[];
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}

const root=fileURLToPath(new URL('../frontend/',import.meta.url));
const port=Number(process.env.PORT||19527);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/storage'&&req.method==='GET'){json(res,200,{driver:database?'mysql':'local'});return;}
  if(database&&pathname.startsWith('/api/')){
    try{
      if(!isLocalConfigRequest(req,port)){json(res,403,{message:'接口仅限本机访问'});return;}
      if(!['GET','HEAD'].includes(req.method)&&(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json'))){json(res,403,{message:'请通过本机页面提交 JSON 请求'});return;}
      if(pathname.startsWith('/api/auth/')){
        const allowed={'/api/auth/session':'GET','/api/auth/login':'POST','/api/auth/logout':'POST'};
        if(allowed[pathname]!==req.method){json(res,405,{message:'请求方式不支持'});return;}
        json(res,200,await persistent.auth(req,res,pathname,req.method==='POST'?await bodyJson(req,4096):null));return;
      }
      const actor=await persistent.user(req);
      if(!actor){json(res,401,{message:'请先登录，或登录会话已过期'});return;}
      if(pathname==='/api/import/browser'||pathname==='/api/workspaces'||pathname==='/api/workspaces/delete'||pathname.startsWith('/api/data/')){
        if(pathname==='/api/workspaces/delete'&&(projectBusy||sourcesBusy||active)){json(res,409,{message:'请等待排查或配置操作完成后归档空间'});return;}
        const input=['GET','HEAD'].includes(req.method)?null:await bodyJson(req);
        const scope=new URL(req.url,'http://localhost').searchParams.get('workspace')||input?.workspace;
        if(pathname==='/api/workspaces/delete')projectBusy=sourcesBusy=true;
        try{
          const result=await persistent.handle(pathname,req.method,input,scope,actor);
          if(pathname==='/api/workspaces/delete'){
            sourceStore={...sourceStore,sources:sourceStore.sources.filter(s=>s.workspace!==scope)};
            projectStore={...projectStore,projects:projectStore.projects.filter(p=>p.workspace!==scope)};
          }
          json(res,200,result);
        }finally{if(pathname==='/api/workspaces/delete')projectBusy=sourcesBusy=false}
        return;
      }
    }catch(e){json(res,e.status||500,{message:e.status?e.message:e.code==='ER_DUP_ENTRY'?'名称已存在，请修改后重试':'数据库操作失败，请检查连接和结构；未完成的事务已回滚'});return;}
  }
  if(pathname==='/api/investigations/followup/stream'){
    if(req.method!=='POST'){json(res,405,{message:'请求方式不支持'});return;}
    if(!isLocalConfigRequest(req,port)||req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请从本机页面发起追问'});return;}
    const now=Date.now();while(attempts.length&&attempts[0]<now-60000)attempts.shift();
    if(active>=2||attempts.length>=10){json(res,429,{message:'追问请求过于频繁，请稍后重试'});return;}
    active++;attempts.push(now);
    const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort()};res.on('close',disconnect);
    const emit=(event,data)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)};
    try{
      const input=await bodyJson(req,1500000),scope=workspaceKey(input.workspace);
      if(typeof input.reportId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.reportId))throw Error('排查记录标识无效');
      const report=database?await persistent.handle('/api/data/investigations/'+input.reportId,'GET',null,scope):input.report;
      if(report?.id!==input.reportId||report.workspaceId!==scope)throw Error('排查报告不属于当前空间');
      if(database&&((report.followups||[]).length!==input.expectedCount||(report.revision??0)!==(input.revision??0)))throw Error('对话或证据已更新，请重新打开报告后追问');
      const markdown=database?(await persistent.handle('/api/data/knowledge','GET',null,scope)).markdown:input.markdown;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
      const turn=await followup(aiConfig,report,input.question,markdown,emit,{signal:controller.signal});
      const update={turn,expectedCount:input.expectedCount,revision:input.revision};
      let saved=false,saveError='';
      if(database){try{await persistent.handle('/api/data/investigations/'+input.reportId+'/followups','POST',update,scope);saved=true}catch{saveError='回答已完成，但保存失败，请点击重试保存；若对话已更新，请先导出并重新打开报告。'}}
      emit('done',{turn,saved,saveError});res.end();
    }catch(e){if(!res.destroyed){const message=e.code?'追问服务暂不可用，请重试':e.message;if(res.headersSent){emit('error',{message});res.end()}else json(res,e.status||400,{message})}}
    finally{active--;res.off('close',disconnect)}return;
  }
  if(req.url==='/api/investigations/stream'){
    if(req.method!=='POST'){json(res,405,{message:'请求方式不支持'});return;}
    if(!isLocalConfigRequest(req,port)||req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请从本机页面发起排查'});return;}
    const now=Date.now();while(attempts.length&&attempts[0]<now-60000)attempts.shift();
    if(active>=2||attempts.length>=10){json(res,429,{message:'排查请求过于频繁，请稍后重试'});return;}
    active++;attempts.push(now);
    const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort()};res.on('close',disconnect);
    const emit=(event,data)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)};
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>450000){json(res,413,{message:'排查请求过大'});return;}chunks.push(chunk)}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString());workspaceKey(input?.workspace)}catch{json(res,400,{message:'排查请求格式无效'});return;}
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
      const report=await investigate(input,sourceStore.sources,aiConfig,emit,{signal:controller.signal,knownHostsFile});
      controller.signal.throwIfAborted();
      if(database)try{await database.transaction(async conn=>{const [[w]]=await conn.execute('SELECT id FROM workspaces WHERE id=? AND deleted_at IS NULL FOR UPDATE',[input.workspace]);if(!w)throw Error();await insertReport(conn,report,input.workspace)})}catch{throw Error('排查完成但数据库保存失败，请检查连接后重试')}
      emit('done',{report});res.end();
    }catch(e){if(!res.destroyed){if(res.headersSent){emit('error',{message:e.message});res.end()}else json(res,500,{message:e.message})}}
    finally{active--;res.off('close',disconnect)}return;
  }
  if(req.url==='/api/workspaces/delete'){
    if(!isLocalConfigRequest(req,port)||req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请通过本机页面删除工作空间'});return;}
    if(req.method!=='POST'){json(res,405,{message:'请求方式不支持'});return;}
    if(projectBusy||sourcesBusy){json(res,409,{message:'项目或数据源操作尚未结束，请完成后重试删除'});return;}
    projectBusy=sourcesBusy=true;
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){json(res,413,{message:'请求过大'});return;}chunks.push(chunk)}
      let workspace;try{workspace=workspaceKey(JSON.parse(Buffer.concat(chunks).toString()).workspace)}catch{json(res,400,{message:'工作空间标识无效'});return;}
      // Commit each store before updating memory. Retrying finishes a partially completed cleanup.
      const sources={...sourceStore,sources:sourceStore.sources.filter(s=>s.workspace!==workspace)};
      await saveSources(sourcesFile,sources);sourceStore=sources;
      const projects={...projectStore,projects:projectStore.projects.filter(p=>p.workspace!==workspace)};
      await saveProjects(projectsFile,projects);projectStore=projects;
      json(res,200,{deleted:true});
    }catch{json(res,500,{message:'空间清理未完成，部分配置可能已删除。空间入口保留，请重试以完成清理'})}
    finally{projectBusy=sourcesBusy=false;}return;
  }
  if(req.url?.split('?')[0]==='/api/projects'){
    if(!isLocalConfigRequest(req,port)){json(res,403,{message:'项目配置与分析仅限本机页面访问'});return;}
    if(req.method==='GET'){
      try{const workspace=workspaceKey(new URL(req.url,'http://localhost').searchParams.get('workspace'));json(res,200,{projects:publicProjects(projectStore,workspace)})}catch(e){json(res,400,{message:e.message})}return;
    }
    if(req.method!=='POST'){json(res,405,{message:'请求方式不支持'});return;}
    if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请从本机页面操作项目'});return;}
    if(projectBusy){json(res,429,{message:'正在保存或分析项目，请等待当前操作完成'});return;}
    projectBusy=true;const controller=new AbortController();const disconnect=()=>{if(!res.writableEnded)controller.abort()};res.on('close',disconnect);
    const emit=(event,data)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)};
    let counted=false;
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>450000){json(res,413,{message:'项目请求过大，请缩短业务文档'});return;}chunks.push(chunk)}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));workspaceKey(input?.workspace)}catch{json(res,400,{message:'项目请求格式无效'});return;}
      if(['save','delete'].includes(input.action)){
        let next;try{next=changeProjects(projectStore,input)}catch(e){json(res,400,{message:e.message});return;}
        await saveProjects(projectsFile,next);projectStore=next;json(res,200,{projects:publicProjects(projectStore,input.workspace)});return;
      }
      if(input.action!=='analyze'){json(res,400,{message:'不支持的项目操作'});return;}
      const project=projectStore.projects.find(p=>p.id===input.id&&p.workspace===input.workspace);
      if(!project){json(res,404,{message:'当前空间未找到该项目'});return;}
      if(!aiConfig.enabled){json(res,400,{message:'请先配置并启用 AI 模型服务商'});return;}
      const now=Date.now();while(attempts.length&&attempts[0]<now-60000)attempts.shift();
      if(active>=2||attempts.length>=10){json(res,429,{message:'分析请求过于频繁，请稍后重试'});return;}
      const requestConfig=aiConfig;active++;attempts.push(now);counted=true;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
      const analysis=await analyzeProject(project,requestConfig,input.markdown,emit,{signal:controller.signal});controller.signal.throwIfAborted();
      emit('stage',{phase:'saving',message:'业务链路分析完成，正在保存到工作空间'});
      const next={...projectStore,projects:projectStore.projects.map(p=>p.id===project.id?{...p,analysis,analysisStale:false}:p)};
      await saveProjects(projectsFile,next);projectStore=next;
      emit('done',{projects:publicProjects(projectStore,input.workspace),projectId:project.id});res.end();
    }catch(e){
      const message=e.code?'项目操作或本机保存失败，原有分析结果保留':e.message||'项目分析失败，原有结果保留';
      if(!res.destroyed){if(res.headersSent){emit('error',{message});res.end()}else json(res,500,{message})}
    }finally{res.off('close',disconnect);projectBusy=false;if(counted)active--;}return;
  }
  if(req.url?.split('?')[0]==='/api/log-sources'){
    if(!isLocalConfigRequest(req,port)){json(res,403,{message:'服务器配置仅限本机页面访问'});return;}
    if(req.method==='GET'){
      try{const scope=workspaceKey(new URL(req.url,'http://localhost').searchParams.get('workspace'));json(res,200,{sources:publicSources(sourceStore,scope)});}catch(e){json(res,400,{message:e.message})}return;
    }
    if(req.method!=='POST'){json(res,405,{message:'请求方式不支持'});return;}
    if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请通过本机页面保存服务器配置'});return;}
    if(sourcesBusy){json(res,429,{message:'正在执行数据源操作，请稍后重试'});return;}
    sourcesBusy=true;
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){json(res,413,{message:'配置过大'});return;}chunks.push(chunk)}
      let input,next;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));workspaceKey(input?.workspace)}catch(e){json(res,400,{message:e instanceof SyntaxError?'配置 JSON 无效':e.message});return;}
      if(['test','search'].includes(input.action)){
        const source=sourceStore.sources.find(s=>s.id===input.id&&s.workspace===input.workspace);
        if(!source){json(res,404,{message:'当前工作空间未找到该数据源'});return;}
        const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort()};res.on('close',disconnect);
        let result,error;
        try{result=await runServerLogs(source,{action:input.action,query:input.query,knownHostsFile,signal:controller.signal})}catch(e){error=e}
        finally{res.off('close',disconnect)}
        if(controller.signal.aborted)return;
        const lastCheck={ok:!error&&result?.ok!==false,checkedAt:result?.checkedAt||new Date().toISOString(),message:error?.message||result?.message||'SSH 登录与日志读取检查通过'};
        const checkedStore={...sourceStore,sources:sourceStore.sources.map(s=>s.id===source.id?{...s,lastCheck}:s)};
        let saveWarning='';try{await saveSources(sourcesFile,checkedStore);sourceStore=checkedStore}catch{saveWarning='检查状态未保存，请检查当前存储连接与权限'}
        if(error){json(res,502,{message:error.message,saveWarning,sources:publicSources(sourceStore,input.workspace)});return;}
        json(res,200,{sources:publicSources(sourceStore,input.workspace),result,saveWarning});return;
      }
      try{next=changeSources(sourceStore,input)}catch(e){json(res,400,{message:e.message});return;}
      try{await saveSources(sourcesFile,next);sourceStore=next;json(res,200,{sources:publicSources(sourceStore,input.workspace)});}catch{json(res,500,{message:'服务器配置未保存，请检查存储连接与权限；原配置保留'})}
    }catch{if(!res.headersSent)json(res,400,{message:'保存请求未完成'})}finally{sourcesBusy=false}return;
  }
  if(req.url==='/api/ai/status'&&req.method==='GET'){json(res,200,status(aiConfig));return;}
  if(['/api/ai/config','/api/ai/test','/api/ai/providers'].includes(req.url)){
    if(!isLocalConfigRequest(req,port)){json(res,403,{message:'模型配置仅限本机 localhost 或 127.0.0.1 页面访问'});return;}
    if(req.url==='/api/ai/providers'&&req.method==='GET'){json(res,200,publicStore(modelStore));return;}
    if(req.url==='/api/ai/config'&&req.method==='GET'){json(res,200,publicConfig(aiConfig));return;}
    if(!((req.url==='/api/ai/config'&&req.method==='PUT')||(['/api/ai/test','/api/ai/providers'].includes(req.url)&&req.method==='POST'))){json(res,405,{message:'请求方式不支持'});return;}
    if(req.headers.origin!==`http://${req.headers.host}`||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{message:'请通过本机页面提交配置'});return;}
    if(configBusy){json(res,429,{message:'正在保存或测试模型，请稍后重试'});return;}
    configBusy=true;
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>65536){json(res,413,{message:'配置内容过大'});return;}chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{json(res,400,{message:'配置格式无效'});return;}
      let next;
      try{
        if(req.url==='/api/ai/test'){
          const saved=modelStore.providers.find(p=>p.id===input?.id);
          if(input?.id&&!saved)throw Error('该服务商已不存在，请刷新列表');
          next=input?.savedOnly?saved:candidate(input,saved);
          if(!next?.enabled)throw Error('请先完善模型和密钥');
        }else{
          const mutation=req.url==='/api/ai/config'?{...input,action:'save',id:modelStore.activeId,name:activeConfig(modelStore).name||'默认模型服务',activate:!input?.clearKey}:input;
          next=changeStore(modelStore,mutation);
        }
      }catch(e){json(res,400,{message:e.message});return;}
      if(req.url==='/api/ai/test'){
        try{await analyzeStream(next,{report:{question:'这是连接测试，无交易和日志证据，请简短回答已连接，不做交易判断。',evidence:[]},markdown:''},()=>{});json(res,200,{message:'连接成功，已通过分析使用的流式请求验证并收到完整文本。测试未修改配置。',model:next.model});}
        catch(e){json(res,502,{message:e.message});}
      }else{
        try{await saveModels(configFile,next);modelStore=next;aiConfig=activeConfig(modelStore);json(res,200,req.url==='/api/ai/config'?publicConfig(aiConfig):publicStore(modelStore));}
        catch{json(res,500,{message:'配置保存失败，原配置仍有效，请检查存储连接与权限'});}
      }
    }catch{if(!res.headersSent)json(res,400,{message:'配置请求未完成，请重试'});}finally{configBusy=false;}
    return;
  }
  if(['/api/ai/analyze','/api/ai/analyze/stream'].includes(req.url)&&req.method==='POST'){
    const origin=req.headers.origin;
    if(!origin||![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(origin)){json(res,403,{message:'仅允许同源页面调用'});return;}
    if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{message:'需要 JSON 请求'});return;}
    const now=Date.now();while(attempts.length&&attempts[0]<now-60000)attempts.shift();
    if(active>=2||attempts.length>=10){json(res,429,{message:'分析请求过于频繁，请稍后重试'});return;}
    if(!aiConfig.enabled){json(res,503,{message:'请在本机服务配置页面保存模型连接信息'});return;}
    const requestConfig=aiConfig;
    const streaming=req.url.endsWith('/stream'),controller=new AbortController();
    const disconnect=()=>{if(!res.writableEnded)controller.abort()};
    res.on('close',disconnect);
    const emit=(event,data)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)};
    active++;attempts.push(now);
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>512000){json(res,413,{message:'请求过大，请缩短文档'});return;}chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{message:'请求 JSON 无效'});return;}
      if(streaming){
        if(res.destroyed)return;
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
        const result=await analyzeStream(requestConfig,input,emit,{signal:controller.signal});
        emit('done',result);res.end();
      }else{const result=await analyze(requestConfig,input);json(res,200,result);}
    }catch(e){
      if(!res.destroyed){if(res.headersSent){emit('error',{message:e.message||'模型分析失败'});res.end()}else json(res,502,{message:e.message||'模型分析失败'});}
    }finally{res.off('close',disconnect);active--;}
    return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Try PORT=${port+1} npm start.`:error.message);process.exit(1)});
server.listen(port,'127.0.0.1',()=>console.log(`PayTrace: http://127.0.0.1:${port}`));

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await database?.close();process.exit(0)})});
