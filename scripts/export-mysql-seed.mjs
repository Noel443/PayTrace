// Generate additive SQL without connecting to MySQL. Sensitive output is ignored by Git.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDatabaseConfig,secretCodec} from './database.mjs';
import {readSources} from './log-sources.mjs';
import {readProjects} from './projects.mjs';
import {readStore} from './model-config.mjs';
import {loadEnv,config} from './ai.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Hex literals are independent of NO_BACKSLASH_ESCAPES and cannot terminate SQL strings.
export const sqlLiteral=value=>value===null?'NULL':value===''?"''":`CONVERT(0x${Buffer.from(String(value)).toString('hex')||''} USING utf8mb4)`;
export async function exportSeed({sources,projects,models,codec}){
  let sql=`-- 变更时间：${new Date().toISOString()}
-- 目的：导入本机已有配置；涉及 workspaces、projects、log_sources、model_providers、app_settings、schema_migrations。
-- 私有文件，可能含本地路径与内部服务地址，请勿提交或分享。密码/API Key已加密。
-- 先执行建表和基础数据脚本。仅添加缺失数据，不覆盖现有记录或恢复归档数据。
-- 必须使用生成时的 encryptionKey 启动应用；不要丢失该密钥。
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+08:00';
START TRANSACTION;
`;
  for(const id of new Set([...sources.sources,...projects.projects].map(v=>v.workspace)))sql+=`INSERT INTO workspaces(id,name,description,businesses) VALUES(${sqlLiteral(id)},${sqlLiteral('待确认-'+id.slice(-30))},'从本机配置导入，请在页面完善名称',JSON_ARRAY('通用业务')) ON DUPLICATE KEY UPDATE id=id;\n`;
  for(const [table,items,secret] of [['projects',projects.projects,null],['log_sources',sources.sources,'password'],['model_providers',models.providers,'key']]){
    for(const item of items){const payload={...item};let cipher=null;if(secret){cipher=payload[secret]?codec.encrypt(payload[secret]):null;delete payload[secret]}
      const columns=(table==='model_providers'?'id,name,payload':'id,workspace_id,name,payload')+(secret?',secret_cipher':'');
      const values=table==='model_providers'?[item.id,item.name,JSON.stringify(payload)]:[item.id,item.workspace,item.name,JSON.stringify(payload)];
      if(secret)values.push(cipher);
      sql+=`INSERT INTO ${table} (${columns}) VALUES (${values.map(sqlLiteral).join(',')}) ON DUPLICATE KEY UPDATE id=id;\n`;
    }
  }
  if(models.activeId)sql+=`UPDATE app_settings SET active_model_id=${sqlLiteral(models.activeId)} WHERE id=1 AND active_model_id IS NULL AND EXISTS (SELECT 1 FROM model_providers WHERE id=${sqlLiteral(models.activeId)} AND deleted_at IS NULL);\n`;
  const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_private';
  return sql+`INSERT INTO schema_migrations(version) VALUES(${sqlLiteral(version)}) ON DUPLICATE KEY UPDATE version=version;\nCOMMIT;\n`;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    await loadEnv();const c=await readDatabaseConfig();if(!/^[a-f0-9]{64}$/i.test(c.encryptionKey||''))throw Error('请先填写 config/database.json 的 encryptionKey；此命令无需启动 MySQL');
    const sources=await readSources(process.env.LOG_SOURCES_FILE||path.join(root,'data/log-sources.json'));
    const projects=await readProjects(process.env.PROJECTS_FILE||path.join(root,'data/projects.json'));
    const models=await readStore(process.env.AI_CONFIG_FILE||path.join(root,'data/ai-config.json'),config());
    const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14),file=path.join(root,'sql',stamp+'_private_local_seed.sql');
    const sql=await exportSeed({sources,projects,models,codec:secretCodec(c.encryptionKey)});await writeFile(file,sql,{flag:'wx',mode:0o600});
    console.log('私有迁移 SQL 已生成：'+path.relative(root,file)+'；请在基础数据 SQL 之后执行。');
  }catch{console.error('导出失败：请检查数据库配置及原 data 文件格式；未覆盖已有文件。');process.exitCode=1}
}
