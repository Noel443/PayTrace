window.initializeMysqlBrowser=async()=>{
  async function request(path,method='GET',body){const response=await fetch(path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok){if(response.status===401)location.replace('./login.html');throw Error(value.message||'数据库请求失败')}return value}
  // Snapshot the old browser data before replacing the catalog. Import is explicit and never clears it.
  const legacyRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const legacy=window.workspaceCatalog.map(w=>{const prefix='paytrace.frontend.v1.'+(w.id==='card'?'':w.id+'.');return {workspace:w,knowledge:legacyRead(prefix+'knowledge',null),reports:legacyRead(prefix+'reports',[])}});
  document.querySelector('#knowledge-storage-location').textContent='存储位置：MySQL 数据库。切换浏览器仍可查看已保存的文档。';
  document.querySelector('#knowledge-storage-help').textContent='文档按工作空间保存在数据库。代码读取与 AI 链路分析由上方项目卡片单独发起。';
  const result=await request('/api/workspaces');if(!result.workspaces.length)throw Error('数据库没有工作空间，请先执行初始化数据 SQL');window.workspaceCatalog=result.workspaces;
  window.localApi=(path,method='GET',body,scope='card')=>request('/api/data'+path+'?workspace='+encodeURIComponent(scope),method,body);
  window.workspaceData.create=async input=>{const {workspace}=await request('/api/workspaces','POST',input);window.workspaceCatalog.push(workspace);return workspace};
  window.workspaceData.update=async(id,input)=>{const {workspace}=await request('/api/workspaces','POST',{...input,id});Object.assign(window.workspaceData.get(id),workspace);return workspace};
  // The server has already archived the workspace and its children in one transaction.
  window.workspaceData.remove=id=>{window.workspaceCatalog=window.workspaceCatalog.filter(w=>w.id!==id)};
  if(window.paytraceRuntime?.environment==='production')return;
  const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='导入此浏览器旧数据';
  const notice=document.createElement('p');notice.textContent='当前使用 MySQL。可将此浏览器此前保存的空间、文档和真实排查记录导入；已有数据库内容不会被覆盖。';notice.append(button);document.querySelector('#settings').prepend(notice);
  button.onclick=async()=>{button.disabled=true;try{const result=await request('/api/import/browser','POST',{workspaces:legacy});alert('导入完成：'+result.message+'。原浏览器数据保留。');location.reload()}catch(e){alert(e.message)}finally{button.disabled=false}};
};
