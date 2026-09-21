// Only this fixed mapping is allowed to provide SQL identifiers.
const stores={sources:{table:'log_sources',key:'sources',secret:'password'},projects:{table:'projects',key:'projects'},models:{table:'model_providers',key:'providers',secret:'key'}};
export const decode=value=>typeof value==='string'?JSON.parse(value):value;
export async function readMysqlStore(db,type){
  const spec=stores[type];if(!spec)throw Error('存储类型无效');
  const [rows]=await db.pool.execute(`SELECT payload, ${spec.secret?'secret_cipher':'NULL AS secret_cipher'} FROM ${spec.table} WHERE deleted_at IS NULL ORDER BY created_at, id`);
  const items=rows.map(row=>{const item=decode(row.payload);if(spec.secret)item[spec.secret]=row.secret_cipher?db.codec.decrypt(row.secret_cipher):'';return item});
  if(type==='models'){const [[state]]=await db.pool.execute('SELECT active_model_id FROM app_settings WHERE id=1');return {version:2,providers:items,activeId:state.active_model_id}}
  return {version:1,[spec.key]:items};
}
export async function writeMysqlStore(db,type,next){
  const spec=stores[type];if(!spec)throw Error('存储类型无效');
  await db.transaction(async conn=>{
    const [current]=await conn.execute(`SELECT id FROM ${spec.table} WHERE deleted_at IS NULL FOR UPDATE`);
    const ids=new Set(next[spec.key].map(v=>v.id));
    for(const {id} of current)if(!ids.has(id))await conn.execute(`UPDATE ${spec.table} SET deleted_at=CURRENT_TIMESTAMP WHERE id=?`,[id]);
    for(const item of next[spec.key]){
      if(type!=='models'){const [[w]]=await conn.execute('SELECT id FROM workspaces WHERE id=? AND deleted_at IS NULL',[item.workspace]);if(!w)throw Error('工作空间不存在或已归档')}
      const payload={...item};const encrypted=spec.secret&&payload[spec.secret]?db.codec.encrypt(payload[spec.secret]):null;
      if(spec.secret)delete payload[spec.secret];
      const cols=(type==='models'?'id,name,payload':'id,workspace_id,name,payload')+(spec.secret?',secret_cipher':'');
      const values=type==='models'?[item.id,item.name,JSON.stringify(payload)]:[item.id,item.workspace,item.name,JSON.stringify(payload)];
      if(spec.secret)values.push(encrypted);
      await conn.execute(`INSERT INTO ${spec.table} (${cols}) VALUES (${values.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE name=VALUES(name),payload=VALUES(payload)${spec.secret?',secret_cipher=VALUES(secret_cipher)':''}`,values);
    }
    if(type==='models')await conn.execute('UPDATE app_settings SET active_model_id=? WHERE id=1',[next.activeId]);
  });
}
