import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from './ai.mjs';

export function publicConfig(c){return {provider:c.provider,base:c.base,model:c.model,hasKey:!!c.key,enabled:c.enabled};}
export function candidate(input,current={}){
  if(!input||!['compatible','ollama'].includes(input.provider))throw Error('请选择有效的接口类型');
  const base=String(input.base||'').trim().replace(/\/+$/,'');
  let url;try{url=new URL(base)}catch{throw Error('请填写有效的接口根地址')}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('接口地址仅支持 HTTP/HTTPS，不能包含密码、查询参数或片段');
  const model=String(input.model||'').trim(),entered=String(input.key||'').trim();
  if(!model||model.length>200||base.length>2000||entered.length>4096||/[\r\n]/.test(entered))throw Error('请检查模型名、接口地址和密钥格式');
  const same=current.provider===input.provider&&current.base===base;
  const key=input.provider==='ollama'?'':(input.clearKey?'':entered||(same?current.key:''));
  if(input.provider==='compatible'&&!key&&!input.clearKey)throw Error('请输入 API Key；更换接口地址后需重新填写密钥');
  return config({AI_PROVIDER:input.provider,AI_BASE_URL:base,AI_MODEL:model,AI_API_KEY:key});
}
export async function readConfig(file,fallback){
  try {const saved=JSON.parse(await readFile(file,'utf8'));return candidate(saved,{provider:'',base:'',key:''});}
  catch(e){if(e.code==='ENOENT')return fallback;throw Error('本地模型配置无法读取，请检查 data/ai-config.json');}
}
export async function writeConfig(file,c){
  await writeJson(file,{...c,clearKey:!c.key});
}
export async function writeJson(file,value){
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(temp,file);}
  finally{await unlink(temp).catch(()=>{});}
}
export function activeConfig(store){return store.providers.find(p=>p.id===store.activeId)||config({});}
export function publicStore(store){return {activeId:store.activeId,providers:store.providers.map(p=>({id:p.id,name:p.name,...publicConfig(p)}))};}
export function changeStore(store,input){
  if(!input||typeof input!=='object')throw Error('配置格式无效');
  const existing=store.providers.find(p=>p.id===input.id);
  if(input.id&&!existing)throw Error('该服务商已不存在，请刷新列表');
  if(input.action==='activate'){
    if(!existing?.enabled)throw Error('请先完善该服务商的模型和密钥');
    return {...store,activeId:existing.id};
  }
  if(input.action==='delete'){
    if(!existing)throw Error('请选择服务商');
    return {...store,activeId:existing.id===store.activeId?null:store.activeId,providers:store.providers.filter(p=>p.id!==existing.id)};
  }
  if(input.action!=='save')throw Error('不支持的配置操作');
  const name=String(input.name||'').trim();
  if(!name||name.length>60)throw Error('请填写 1–60 个字符的服务商名称');
  if(store.providers.some(p=>p.id!==existing?.id&&p.name.toLowerCase()===name.toLowerCase()))throw Error('服务商名称已存在');
  if(!existing&&store.providers.length>=30)throw Error('最多保存 30 个服务商');
  const entry={...candidate(input,existing),id:existing?.id||randomUUID(),name};
  if(input.activate&&!entry.enabled)throw Error('请先完善模型和密钥，再启用');
  return {version:2,activeId:input.activate?entry.id:store.activeId,providers:existing?store.providers.map(p=>p.id===entry.id?entry:p):[...store.providers,entry]};
}
export async function readStore(file,fallback){
  let saved;
  try{saved=JSON.parse(await readFile(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')saved=fallback;else throw Error('本地模型配置无法读取，请检查配置文件');}
  try{
    if(saved.version===2){
      if(!Array.isArray(saved.providers)||saved.providers.length>30)throw Error();
      const ids=new Set();
      const providers=saved.providers.map(p=>{
        if(typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60)throw Error();
        ids.add(p.id);return {...candidate({...p,clearKey:!p.key}),id:p.id,name:p.name};
      });
      if(saved.activeId!==null&&!ids.has(saved.activeId))throw Error();
      return {version:2,activeId:saved.activeId,providers};
    }
    // Legacy file and .env remain untouched until the next explicit save.
    const providers=saved.base&&saved.model?[{...candidate({...saved,clearKey:!saved.key}),id:'legacy-default',name:'默认模型服务'}]:[];
    return {version:2,activeId:providers[0]?.id||null,providers};
  }catch{throw Error('本地模型配置格式无效，请检查配置文件');}
}
export async function writeStore(file,store){await writeJson(file,store);}
export function isLocalConfigRequest(req,port){
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && [`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`].includes(req.headers.host)
    && !['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto'].some(h=>req.headers[h]);
}
