import '../frontend/followup-data.js';
import {randomUUID,randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {workspaceKey} from './log-sources.mjs';
import {decode} from './mysql-store.mjs';
const scrypt=promisify(scryptCallback);
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString('hex')}`}
export async function verifyPassword(password,hash){const [algorithm,salt,expected]=hash.split(':');if(algorithm!=='scrypt'||!/^[a-f0-9]{128}$/.test(expected||''))return false;const actual=await scrypt(password,salt,64);return timingSafeEqual(actual,Buffer.from(expected,'hex'))}
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
export async function bodyJson(req,max=4000000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)fail('请求内容过大',413);chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('请求 JSON 无效')}}
function workspaceInput(input){
  const name=String(input?.name||'').trim(),description=String(input?.description||'').trim();
  const businesses=Array.isArray(input?.businesses)?input.businesses:String(input?.businesses||'').split(/[,，、\n]/).map(s=>s.trim()).filter(Boolean);
  if(!name||name.length>40||description.length>300||businesses.length>12||businesses.some(b=>typeof b!=='string'||!b.trim()||b.length>40))fail('请检查空间名称、说明和业务线');
  return {name,description,businesses};
}
export function knowledgeInput(body){
  if(typeof body?.scanEnabled!=='boolean'||!Array.isArray(body.projects)||body.projects.length>20||typeof body.markdown!=='string'||body.markdown.length>100000)fail('知识配置格式无效或文档超过10万字');
  const projects=body.projects.map(p=>({name:String(p?.name||'').trim(),path:String(p?.path||'').trim(),branch:String(p?.branch||'master').trim()}));
  if(projects.some(p=>!p.name||!p.path||p.name.length>100||p.path.length>1000||p.branch.length>200)||body.scanEnabled&&!projects.length)fail('项目路径配置无效');
  return {scanEnabled:body.scanEnabled,projects,markdown:body.markdown,updatedAt:new Date().toISOString()};
}
export function reportInput(body,scope){
  if(!body||body.kind!=='real'||body.workspaceId!==scope||typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id)||typeof body.transaction?.id!=='string'||body.transaction.id.length>200||!Array.isArray(body.evidence)||!Array.isArray(body.coverage)||!body.ai||typeof body.ai.text!=='string'||!Number.isFinite(Date.parse(body.createdAt))||!Number.isInteger(body.revision??0)||(body.revision??0)<0||(body.revision??0)>4294967295)fail('排查报告格式无效');
  if(body.feedback?.status&&!['已解决','需要开发介入','判断不正确'].includes(body.feedback.status))fail('反馈状态无效');
  return body;
}
export async function insertReport(conn,report,scope){
  reportInput(report,scope);
  // A retry never overwrites saved feedback or resurrects an archived report.
  await conn.execute('INSERT INTO investigations (id,workspace_id,transaction_id,revision,feedback_status,payload,created_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[report.id,scope,report.transaction.id,report.revision??0,report.feedback?.status||null,JSON.stringify(report),new Date(report.createdAt)]);
}
export async function listWorkspaces(conn,environment){const [rows]=await conn.execute('SELECT id,name,description,businesses FROM workspaces WHERE deleted_at IS NULL'+(environment?' AND environment=?':'')+' ORDER BY created_at,id',environment?[environment]:[]);return rows.map(row=>({...row,businesses:decode(row.businesses),custom:row.id.startsWith('ws-'),repository:'',commit:'',services:[],cases:[],flow:[]}))}
export function mysqlApi(db){
  const attempts=[];
  async function user(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('paytrace_session='))?.slice(17);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const [[row]]=await db.pool.execute('SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND u.enabled=1',[digest(token)]);return row||null}
  async function auth(req,res,pathname,input){
    if(pathname==='/api/auth/session')return {user:await user(req)};
    if(pathname==='/api/auth/logout'){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('paytrace_session='))?.slice(17);if(token)await db.pool.execute('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?',[digest(token)]);res.setHeader('Set-Cookie','paytrace_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {ok:true}}
    const now=Date.now();while(attempts.length&&attempts[0]<now-60000)attempts.shift();if(attempts.length>=10)fail('登录尝试过于频繁，请稍后重试',429);attempts.push(now);
    if(typeof input?.username!=='string'||input.username.length>60||typeof input.password!=='string'||input.password.length>100)fail('账号或密码不正确',401);
    const [[row]]=await db.pool.execute('SELECT id,username,password_hash FROM users WHERE username=? AND enabled=1',[input.username]);
    if(!row||!await verifyPassword(input.password,row.password_hash))fail('账号或密码不正确',401);
    const token=randomBytes(32).toString('hex');await db.pool.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 8 HOUR))',[digest(token),row.id]);
    res.setHeader('Set-Cookie',`paytrace_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);return {user:{id:row.id,username:row.username}};
  }
  async function handle(pathname,method,input,scope,actor,environment='test'){
    if(!['test','production'].includes(environment))fail('环境标识无效');
    const selectedEnvironment=db.environmentSupport?environment:undefined;
    const list=conn=>listWorkspaces(conn,selectedEnvironment);
    return db.transaction(async conn=>{
      // Serializes document/report edits and workspace lifecycle across API requests.
      await conn.execute('SELECT id FROM app_settings WHERE id=1 FOR UPDATE');
      if(pathname==='/api/import/browser'){
        if(environment!=='test')fail('浏览器旧数据只能导入测试环境',403);
        if(method!=='POST')fail('请求方式不支持',405);
        if(!Array.isArray(input?.workspaces)||input.workspaces.length>33)fail('浏览器迁移数据格式无效');
        let imported=0;
        for(const entry of input.workspaces){
          const id=workspaceKey(entry.workspace?.id),w=workspaceInput(entry.workspace);
          const [[existing]]=await conn.execute(`SELECT id,deleted_at${db.environmentSupport?',environment':''} FROM workspaces WHERE id=?`,[id]);
          if(existing?.deleted_at)continue;
          if(existing&&selectedEnvironment&&existing.environment!==environment)fail('旧数据包含其他环境的空间',409);
          if(!existing)await conn.execute('INSERT INTO workspaces(id,name,description,businesses,created_by) VALUES(?,?,?,?,?)',[id,w.name,w.description,JSON.stringify(w.businesses),actor.id]);
          if(entry.knowledge){const value=knowledgeInput(entry.knowledge);await conn.execute('INSERT INTO workspace_knowledge(workspace_id,payload) VALUES(?,?) ON DUPLICATE KEY UPDATE workspace_id=workspace_id',[id,JSON.stringify(value)])}
          if(!Array.isArray(entry.reports)||entry.reports.length>2000)fail('迁移记录格式无效或数量过多');
          for(const report of entry.reports){if(report?.kind!=='real')continue;await insertReport(conn,report,id);imported++}
        }
        return {message:`已检查 ${input.workspaces.length} 个空间、${imported} 条真实记录；重复数据跳过`};
      }
      if(pathname==='/api/workspaces'){
        if(method==='GET')return {workspaces:await list(conn)};
        if(method!=='POST')fail('请求方式不支持',405);
        const value=workspaceInput(input),id=input.id?workspaceKey(input.id):'ws-'+randomUUID();
        if(input.id&&selectedEnvironment){const [[existing]]=await conn.execute('SELECT id FROM workspaces WHERE id=? AND environment=? AND deleted_at IS NULL',[id,environment]);if(!existing)fail('当前环境下不存在该工作空间',404)}
        if(input.id){const [r]=await conn.execute('UPDATE workspaces SET name=?,description=?,businesses=? WHERE id=? AND deleted_at IS NULL',[value.name,value.description,JSON.stringify(value.businesses),id]);if(!r.affectedRows)fail('工作空间不存在',404)}
        else await conn.execute('INSERT INTO workspaces(id,name,description,businesses,created_by'+(selectedEnvironment?',environment':'')+') VALUES(?,?,?,?,?'+(selectedEnvironment?',?':'')+')',[id,value.name,value.description,JSON.stringify(value.businesses),actor.id,...(selectedEnvironment?[environment]:[])]);
        return {workspace:(await list(conn)).find(w=>w.id===id)};
      }
      workspaceKey(scope);
      const [[workspace]]=await conn.execute('SELECT id FROM workspaces WHERE id=? AND deleted_at IS NULL'+(selectedEnvironment?' AND environment=?':'')+' FOR UPDATE',[scope,...(selectedEnvironment?[environment]:[])]);if(!workspace)fail('工作空间不存在或已归档',404);
      if(pathname==='/api/workspaces/delete'){
        if(method!=='POST')fail('请求方式不支持',405);
        if((await list(conn)).length<=1)fail('至少保留一个工作空间');
        await conn.execute('UPDATE workspaces SET deleted_at=CURRENT_TIMESTAMP WHERE id=?',[scope]);
        for(const table of ['projects','log_sources','investigations'])await conn.execute(`UPDATE ${table} SET deleted_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND deleted_at IS NULL`,[scope]);
        return {deleted:true};
      }
      const route=pathname.replace('/api/data','');
      if(route==='/knowledge'){
        if(!['GET','PUT'].includes(method))fail('请求方式不支持',405);
        if(method==='PUT')await conn.execute('INSERT INTO workspace_knowledge(workspace_id,payload) VALUES(?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)',[scope,JSON.stringify(knowledgeInput(input))]);
        const [[row]]=await conn.execute('SELECT payload FROM workspace_knowledge WHERE workspace_id=?',[scope]);return {...(row?decode(row.payload):{scanEnabled:false,projects:[],markdown:'',updatedAt:null}),usingDefault:false};
      }
      if(['/transactions','/services'].includes(route)){if(method!=='GET')fail('暂无可配置的样例服务',405);return []}
      if(route==='/investigations'){
        if(method==='POST'){await insertReport(conn,input,scope);const [[row]]=await conn.execute('SELECT payload FROM investigations WHERE workspace_id=? AND id=? AND deleted_at IS NULL',[scope,input.id]);if(!row)fail('排查记录已归档',409);return decode(row.payload)}
        if(method==='GET'){const [rows]=await conn.execute('SELECT payload FROM investigations WHERE workspace_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC',[scope]);return rows.map(r=>decode(r.payload))}
        if(method==='DELETE'){
          const ids=input?.ids;if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'||id.length>100)||new Set(ids).size!==ids.length)fail('请选择有效的排查记录');
          for(const id of ids){const [r]=await conn.execute('UPDATE investigations SET deleted_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND deleted_at IS NULL',[scope,id]);if(!r.affectedRows)fail('部分记录不存在，请刷新',409)}return {deleted:ids.length};
        }
        fail('请求方式不支持',405);
      }
      const match=route.match(/^\/investigations\/([a-zA-Z0-9_-]{1,100})(\/(feedback|ai|followups))?$/);
      if(!match)fail('接口不存在',404);
      const [[row]]=await conn.execute('SELECT payload FROM investigations WHERE workspace_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[scope,match[1]]);if(!row)fail('排查记录不存在',404);
      const report=decode(row.payload);
      if(method==='GET'&&!match[2])return report;
      if(method==='DELETE'&&!match[2]){await conn.execute('UPDATE investigations SET deleted_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?',[scope,match[1]]);return {deleted:true}}
      if(method!=='POST'||!match[3])fail('请求方式不支持',405);
      if(match[3]==='feedback'){
        if(!['已解决','需要开发介入','判断不正确'].includes(input?.status)||typeof input.note!=='string'||input.note.length>2000)fail('处理结果或备注格式无效');
        report.feedback={status:input.status,note:input.note,time:new Date().toISOString()};
      }else if(match[3]==='followups'){
        try{PayTraceFollowup.append(report,input)}catch(e){fail(e.message,409)}
      }else{
        if(input?.status!=='completed'||typeof input.text!=='string'||input.text.length>30000)fail('AI 结果格式无效');
        if((input.revision??0)!==(report.revision??0))fail('证据已更新，请重新分析',409);report.ai=input;
      }
      await conn.execute('UPDATE investigations SET payload=?,feedback_status=? WHERE workspace_id=? AND id=?',[JSON.stringify(report),report.feedback?.status||null,scope,match[1]]);return report;
    });
  }
  return {user,auth,handle};
}
