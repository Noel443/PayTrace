import {openDatabase} from './database.mjs';
import {passwordHash} from './mysql-api.mjs';
let db;
try{
  const chunks=[];let size=0;for await(const c of process.stdin){size+=c.length;if(size>512)throw Error();chunks.push(c)}
  const password=Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');
  if(password.length<12||password.length>100)throw Error();
  db=await openDatabase();if(!db)throw Error();
  await db.transaction(async conn=>{const [[user]]=await conn.execute("SELECT id FROM users WHERE username='admin' FOR UPDATE");if(!user)throw Error();await conn.execute('UPDATE users SET password_hash=? WHERE id=?',[await passwordHash(password),user.id]);await conn.execute('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL',[user.id])});
  console.log('admin 密码已更新，已有会话已撤销。');
}catch{console.error('密码修改失败：先停止服务并配置数据库，从标准输入提供 12–100 个字符的新密码。');process.exitCode=1}finally{await db?.close()}
