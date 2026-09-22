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
await import('./serve.mjs');
