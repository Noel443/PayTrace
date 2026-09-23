export const environmentVersion='20260922000100';
export function requestEnvironment(req,{defaultEnvironment='test',switchable=false}={}){
  const value=req.headers['x-paytrace-environment']||defaultEnvironment;
  if(!['test','production'].includes(value))throw Object.assign(Error('环境标识无效'),{status:400});
  if(value!==defaultEnvironment&&!switchable)throw Object.assign(Error('当前服务尚未启用环境切换，请配置 MySQL 并执行环境迁移 SQL'),{status:409});
  return value;
}
export async function requireWorkspaceEnvironment(db,workspace,environment){
  if(!db?.environmentSupport)return;
  const [[row]]=await db.pool.execute('SELECT id FROM workspaces WHERE id=? AND environment=? AND deleted_at IS NULL',[workspace,environment]);
  if(!row)throw Object.assign(Error('当前环境下不存在该工作空间'),{status:404});
}
