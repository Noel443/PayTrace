import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadEnv,config,status,analyze,analyzeStream} from './ai.mjs';
import {publicConfig,candidate,readStore,writeStore,activeConfig,publicStore,changeStore,isLocalConfigRequest} from './model-config.mjs';

await loadEnv();
const configFile=process.env.AI_CONFIG_FILE||fileURLToPath(new URL('../data/ai-config.json',import.meta.url));
let modelStore=await readStore(configFile,config());
let aiConfig=activeConfig(modelStore);
let configBusy=false;
let active=0;
const attempts=[];
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}

const root=fileURLToPath(new URL('../frontend/',import.meta.url));
const port=Number(process.env.PORT||5173);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
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
      for await(const chunk of req){size+=chunk.length;if(size>16384){json(res,413,{message:'配置内容过大'});return;}chunks.push(chunk);}
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
        try{await analyze(next,{report:{question:'这是连接测试，无交易和日志证据，请简短回答已连接，不做交易判断。',evidence:[]},markdown:''});json(res,200,{message:'连接成功，模型已返回有效文本。测试未修改配置。',model:next.model});}
        catch(e){json(res,502,{message:e.message});}
      }else{
        try{await writeStore(configFile,next);modelStore=next;aiConfig=activeConfig(modelStore);json(res,200,req.url==='/api/ai/config'?publicConfig(aiConfig):publicStore(modelStore));}
        catch{json(res,500,{message:'本地文件保存失败，原配置仍有效，请检查 data 目录权限'});}
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
