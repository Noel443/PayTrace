import {access} from 'node:fs/promises';
import path from 'node:path';

const requested=String(process.argv[2]||'test').toLowerCase();
if(!['test','prod','production'].includes(requested)){
  console.error('用法：npm start（测试）或 npm run start:prod（生产），也可 npm start -- prod');
  process.exit(2);
}
const production=requested==='prod'||requested==='production';
const root=path.resolve(new URL('..',import.meta.url).pathname);
let envFile=path.join(root,production?'.env.prod':'.env.test');
try{await access(envFile)}catch{
  if(production){console.error('缺少 .env.prod。请复制 .env.prod.example 为 .env.prod 并填写生产配置。');process.exit(2)}
  envFile=path.join(root,'.env');
  try{await access(envFile)}catch{envFile=path.join(root,'.env.test.example')}
}
process.env.PAYTRACE_ENV=production?'production':'test';
process.env.PAYTRACE_ENV_FILE=envFile;
try{
  await import('./serve.mjs');
}catch(error){
  console.error('\n启动失败：'+(error?.message||error));
  if(error?.code==='PAYTRACE_ALREADY_RUNNING')console.error('提示：已有 PayTrace 服务正在运行，请直接打开 http://127.0.0.1:19527，或先停止旧进程再重试。');
  else if(error?.code==='PAYTRACE_SCHEMA_MISSING')console.error('提示：请先按提示执行 sql 初始化脚本。');
  process.exitCode=1;
}
