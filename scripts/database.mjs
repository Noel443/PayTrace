import {readFile} from 'node:fs/promises';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {environmentVersion} from './environments.mjs';

export async function readDatabaseConfig(file){
  const explicit=!!file||!!process.env.DATABASE_CONFIG_FILE;
  file??=process.env.DATABASE_CONFIG_FILE||fileURLToPath(new URL('../config/database.json',import.meta.url));
  let c;
  try{c=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT'&&!explicit)return {driver:'local'};throw Error('数据库配置无法读取，请检查 config/database.json')}
  if(c.driver==='local')return c;
  if(c.driver!=='mysql'||typeof c.host!=='string'||!c.host||!Number.isInteger(c.port)||c.port<1||c.port>65535||typeof c.database!=='string'||!/^[a-zA-Z0-9_]+$/.test(c.database)||typeof c.user!=='string'||!c.user||typeof c.password!=='string'||!Number.isInteger(c.connectionLimit)||c.connectionLimit<2||c.connectionLimit>20||!/^([a-f0-9]{64})$/i.test(c.encryptionKey||''))throw Error('数据库配置无效，请参照 config/database.example.json；加密密钥必须为 64 位十六进制');
  return c;
}
export function secretCodec(key){
  const bytes=Buffer.from(key,'hex');
  return {
    encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',bytes,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')},
    decrypt(value){const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',bytes,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8')}
  };
}
export async function openDatabase(c){
  c??=await readDatabaseConfig();
  if(c.driver==='local')return null;
  const {createPool}=await import('mysql2/promise');
  const pool=createPool({host:c.host,port:c.port,user:c.user,password:c.password,database:c.database,connectionLimit:c.connectionLimit,charset:'utf8mb4_0900_ai_ci',timezone:'+08:00',connectTimeout:10000,waitForConnections:true,queueLimit:30});
  pool.on('connection',conn=>conn.query("SET time_zone = '+08:00'"));
  let lease;
  let lockAcquired=false;
  try{
    lease=await pool.getConnection();
    const [[lock]]=await lease.execute("SELECT GET_LOCK(CONCAT('paytrace:', LEFT(SHA2(DATABASE(),256),48)),0) AS acquired");
    if(Number(lock.acquired)!==1){
      const error=new Error('同一数据库已有 PayTrace 进程运行，请直接使用现有服务或先停止旧进程');
      error.code='PAYTRACE_ALREADY_RUNNING';
      throw error;
    }
    lockAcquired=true;
    const [[row]]=await lease.execute("SELECT version FROM schema_migrations WHERE version = '20260921000100'");
    if(!row){
      const error=new Error('MySQL 数据库尚未初始化，请先执行 sql/20260921000100_initial_schema.sql 和 sql/20260921000200_initial_data.sql');
      error.code='PAYTRACE_SCHEMA_MISSING';
      throw error;
    }
  }catch(error){
    if(lockAcquired)await lease?.execute("SELECT RELEASE_LOCK(CONCAT('paytrace:', LEFT(SHA2(DATABASE(),256),48)))").catch(()=>{});
    lease?.release();await pool.end();
    if(error?.code==='PAYTRACE_ALREADY_RUNNING'||error?.code==='PAYTRACE_SCHEMA_MISSING')throw error;
    const wrapped=new Error('MySQL 连接失败：请检查 config/database.json 中的主机、端口、账号和密码');
    wrapped.code='PAYTRACE_CONNECTION_FAILED';
    wrapped.cause=error;
    throw wrapped;
  }
  const [[environmentMigration]]=await pool.execute('SELECT version FROM schema_migrations WHERE version=?',[environmentVersion]);
  const environmentSupport=!!environmentMigration;
  const codec=secretCodec(c.encryptionKey);
  return {pool,codec,environmentSupport,async close(){await lease.execute("SELECT RELEASE_LOCK(CONCAT('paytrace:', LEFT(SHA2(DATABASE(),256),48)))");lease.release();await pool.end()},async transaction(fn){const conn=await pool.getConnection();try{await conn.beginTransaction();const result=await fn(conn);await conn.commit();return result}catch(e){await conn.rollback();throw e}finally{conn.release()}}};
}
