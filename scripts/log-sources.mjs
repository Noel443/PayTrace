import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {writeJson} from './model-config.mjs';
export function workspaceKey(value){
  if(typeof value!=='string'||!/^(card|cross-border|hk-cb|ws-[a-z0-9-]{1,80})$/.test(value))throw Error('工作空间标识无效');return value;
}
export function sourceCandidate(input,current={}){
  if(!input||typeof input!=='object')throw Error('数据源格式无效');
  const workspace=workspaceKey(input.workspace);
  const str=(key,max,required=true)=>{const value=String(input[key]??'').trim();if((required&&!value)||value.length>max||/[\r\n\0]/.test(value))throw Error('请检查字段：'+({name:'数据源名称',service:'服务标识',host:'服务器地址',username:'SSH 账号',logPath:'日志路径',environment:'环境'}[key]||key));return value};
  let logs;
  if(input.logs!==undefined){
    if(!Array.isArray(input.logs)||!input.logs.length||input.logs.length>20)throw Error('请配置 1–20 条日志规则');
    logs=input.logs.map(row=>{
      const logPath=String(row?.logPath||'').trim(),service=String(row?.service||'').trim();
      if(!logPath||logPath.length>1000||/[\r\n\0]/.test(logPath)||logPath.startsWith('~')&&!logPath.startsWith('~/'))throw Error('日志路径无效');
      if(service&&!/^[a-zA-Z0-9_.-]{1,80}$/.test(service))throw Error('日志服务标识无效');
      if(/[?*]/.test(logPath)&&(!/^[a-zA-Z0-9_.*?-]+$/.test(logPath)))throw Error('通配符仅用于当前日志目录中的文件名，例如 *-console.log');
      return {logPath,service};
    });
    input={...input,logPath:logs[0].logPath,service:logs[0].service||'auto'};
  }
  const name=str('name',60),service=str('service',80),host=str('host',253),username=str('username',100),logPath=str('logPath',1000),environment=str('environment',40);
  if(!isIP(host)&&!(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)&&host.split('.').every(part=>part&&part.length<=63&&!part.startsWith('-')&&!part.endsWith('-'))))throw Error('请填写有效 IP 或主机名，不要包含协议和端口');
  if(!/^[a-zA-Z0-9_.-]+$/.test(service))throw Error('服务标识仅支持字母、数字、点、横线和下划线');
  const port=Number(input.port);if(!Number.isInteger(port)||port<1||port>65535)throw Error('SSH 端口应为 1–65535');
  const logDirectory=str('logDirectory',1000,false);
  if(logDirectory&&!logDirectory.startsWith('/')&&logDirectory!=='~'&&!logDirectory.startsWith('~/'))throw Error('日志目录须为绝对路径或 ~/ 开头的目录');
  if(logPath.startsWith('~')&&!logPath.startsWith('~/'))throw Error('仅支持 ~/ 开头的当前账号主目录路径');
  if(typeof input.enabled!=='boolean')throw Error('请选择是否启用数据源');
  const same=current.workspace===workspace&&current.host===host&&current.port===port&&current.username===username;
  const entered=typeof input.password==='string'?input.password:'';
  if(entered.length>4096||/[\0\r\n]/.test(entered))throw Error('密码格式无效');
  const password=entered||(same?current.password:'');
  if(!password)throw Error('请输入 SSH 密码；更换服务器、端口或账号后需重新填写');
  return {workspace,name,service,host,port,username,logPath,logDirectory,environment,password,enabled:input.enabled,...(logs?{logs}:{})};
}
export function publicSources(store,workspace){return store.sources.filter(s=>s.workspace===workspace).map(({password,...s})=>({...s,hasPassword:!!password,connectionStatus:s.lastCheck?.ok?'最近检查通过':s.lastCheck?'最近检查失败':'未检查'}));}
export function changeSources(store,input){
  const workspace=workspaceKey(input?.workspace);
  const current=store.sources.find(s=>s.id===input.id&&s.workspace===workspace);
  if(input.id&&!current)throw Error('当前工作空间未找到该数据源，请刷新');
  if(input.action==='delete'){
    if(!current)throw Error('请选择数据源');
    return {...store,sources:store.sources.filter(s=>s.id!==current.id)};
  }
  if(input.action==='toggle'){
    if(!current||typeof input.enabled!=='boolean')throw Error('数据源状态无效');
    return {...store,sources:store.sources.map(s=>s.id===current.id?{...s,enabled:input.enabled}:s)};
  }
  if(input.action!=='save')throw Error('不支持的数据源操作');
  if(!current&&store.sources.filter(s=>s.workspace===workspace).length>=30)throw Error('每个空间最多保存 30 个服务器数据源');
  if(store.sources.some(s=>s.workspace===workspace&&s.id!==current?.id&&s.name===String(input.name||'').trim()))throw Error('该空间已有同名数据源');
  const next={...sourceCandidate(input,current),id:current?.id||randomUUID()};
  return {version:1,sources:current?store.sources.map(s=>s.id===current.id?next:s):[...store.sources,next]};
}
export async function readSources(file){
  let data;try{data=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {version:1,sources:[]};throw Error('服务器配置无法读取，请检查本机配置文件')}
  try{
    if(data.version!==1||!Array.isArray(data.sources))throw Error();
    const ids=new Set();const sources=data.sources.map(s=>{if(typeof s.id!=='string'||!s.id||ids.has(s.id))throw Error();ids.add(s.id);return {...sourceCandidate(s),id:s.id,...(s.lastCheck?{lastCheck:s.lastCheck}:{})}});
    return {version:1,sources};
  }catch{throw Error('服务器配置格式无效，请检查本机配置文件')}
}
export const writeSources=writeJson;
