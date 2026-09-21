(() => {
  let sources=[],loadedScope='',editing=null,sourceScope='',saving=false,loadVersion=0;
  const field=name=>document.getElementById('source-'+name);
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>{if(!saving)document.getElementById(button.dataset.closeDialog).close()}));
  $('#source-dialog').addEventListener('cancel',e=>{if(saving)e.preventDefault()});
  $('#source-dialog').addEventListener('close',()=>field('password').value='');
  let editingWorkspace=null;
  const refreshPicker=()=>{$('#workspace-select').innerHTML=window.workspaceCatalog.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');$('#workspace-select').value=workspaceId};
  window.refreshWorkspaceActions=()=>{$('#delete-workspace').disabled=window.workspaceCatalog.length<=1;$('#delete-workspace').title=window.workspaceCatalog.length<=1?'至少保留一个空间，请先新建空间':''};
  window.refreshWorkspaceActions();
  function openWorkspace(edit=false){
    if(busy||window.workspaceMutation)return;
    editingWorkspace=edit?activeWorkspace.id:null;$('#workspace-form').reset();$('#workspace-feedback').textContent='';
    $('#workspace-dialog-title').textContent=edit?'编辑工作空间':'新建工作空间';
    $('#workspace-form button[type="submit"]').textContent=edit?'保存修改':'创建并配置';
    if(edit){$('#workspace-name').value=activeWorkspace.name;$('#workspace-description').value=activeWorkspace.description;$('#workspace-businesses').value=activeWorkspace.businesses.join('、')}
    $('#workspace-dialog').showModal();
  }
  $('#add-workspace').onclick=()=>openWorkspace();$('#edit-workspace').onclick=()=>openWorkspace(true);
  $('#workspace-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy||window.workspaceMutation){$('#workspace-feedback').textContent='请等待当前操作完成';return;}
    try{
      const input={name:$('#workspace-name').value,description:$('#workspace-description').value,businesses:$('#workspace-businesses').value};
      const w=editingWorkspace?window.workspaceData.update(editingWorkspace,input):window.workspaceData.create(input);
      refreshPicker();window.refreshWorkspaceActions();$('#workspace-dialog').close();await switchWorkspace(w.id,'settings');
    }catch(error){$('#workspace-feedback').textContent=error.message}
  });
  $('#delete-workspace').onclick=async()=>{
    if(busy||saving||window.workspaceMutation||window.projectOperationBusy?.()||modelBusy){toast('请等待当前操作完成后删除空间');return;}
    const scope=workspaceId;
    if(window.workspaceCatalog.length<=1){toast('至少保留一个工作空间，请先新建空间');return;}
    if(!confirm('删除工作空间“'+activeWorkspace.name+'”？将删除其本机服务器配置（含密码）、项目及分析结果，以及当前浏览器的文档和排查记录。共用模型配置保留；不删除远程日志或 Git 仓库。此操作无法撤销。'))return;
    window.workspaceMutation=true;$('#delete-workspace').disabled=true;aiJob?.controller.abort();
    try{
      if(location.protocol==='file:')throw Error('请通过 npm start 启动的本机页面删除，以同步清理服务器配置');
      const response=await fetch('/api/workspaces/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:scope}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();if(!response.ok)throw Error(data.message||'空间清理失败');
      window.workspaceData.remove(scope);refreshPicker();window.workspaceMutation=false;
      await switchWorkspace(window.workspaceCatalog[0].id,'settings');toast('工作空间及关联数据已删除');
    }catch(error){toast((error.name==='TimeoutError'?'请求超时，服务器清理状态待核对，请重试':error.message)+'；未完成时保留空间入口')}
    finally{window.workspaceMutation=false;window.refreshWorkspaceActions()}
  };
  async function request(method='GET',body,scope=workspaceId,full=false){
    if(location.protocol==='file:')throw Error('服务器配置需要运行 npm start，通过本机页面访问');
    const response=await fetch('/api/log-sources'+(method==='GET'?'?workspace='+encodeURIComponent(scope):''),{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(125000)});
    let data;try{data=await response.json()}catch{throw Error('数据源服务不可用，请重启 npm start')}
    if(!response.ok){if(data.sources&&scope===workspaceId){sources=data.sources;render()}throw Error((data.message||'数据源请求失败')+(data.saveWarning?'；'+data.saveWarning:''));}return full?data:data.sources;
  }
  function render(){
    $('#remote-source-list').innerHTML=sources.length?sources.map(s=>`<article class="remote-source-card"><div class="provider-heading"><div><h3>${esc(s.name)}</h3><p>${s.logs?s.logs.length+' 条日志规则':esc(s.service)} · ${esc(s.environment)}</p></div><span class="tag ${s.enabled&&s.lastCheck?.ok?'':'amber'}">${s.enabled?'已启用':'已停用'} · ${esc(s.connectionStatus)}</span></div><dl><div><dt>SSH 服务器</dt><dd>${esc(s.host)}:${s.port}</dd></div><div><dt>登录账号</dt><dd>${esc(s.username)} · 密码已保存</dd></div><div><dt>日志路径</dt><dd>${(s.logs||[{logPath:s.logPath}]).map(r=>esc(r.logPath)).join('<br>')}${!s.logPath.startsWith('/')&&!s.logPath.startsWith('~/')?'<br>相对目录：'+esc(s.logDirectory||'SSH 账号主目录'):''}</dd></div></dl><p class="source-check-status">${s.lastCheck?esc(new Date(s.lastCheck.checkedAt).toLocaleString('zh-CN'))+' · '+esc(s.lastCheck.message):'尚未测试连接'}</p><div class="model-actions"><button type="button" class="text-button" data-source-action="test" data-id="${esc(s.id)}" ${!s.enabled?'disabled':''}>测试连接</button><button type="button" class="primary" data-source-action="search" data-id="${esc(s.id)}" ${!s.enabled?'disabled':''}>查询日志</button><button type="button" class="text-button" data-source-action="toggle" data-id="${esc(s.id)}">${s.enabled?'停用':'启用'}</button><button type="button" class="text-button" data-source-action="edit" data-id="${esc(s.id)}">编辑配置</button><button type="button" class="text-button danger-action" data-source-action="delete" data-id="${esc(s.id)}">删除</button></div></article>`).join(''):'<div class="workspace-empty"><h3>还没有服务器日志数据源</h3><p>点击“添加数据源”，填写服务器地址、SSH 账号和日志路径。</p></div>';
  }
  window.loadLogSources=async()=>{
    const scope=workspaceId,version=++loadVersion;loadedScope='';sources=[];$('#add-log-source').disabled=true;$('#remote-source-list').replaceChildren();$('#source-feedback').textContent='正在读取服务器配置…';
    try{const rows=await request('GET',undefined,scope);if(scope!==workspaceId||version!==loadVersion)return;sources=rows;loadedScope=scope;render();$('#add-log-source').disabled=false;$('#source-feedback').textContent='配置存储在本机，按工作空间隔离。'}catch(e){if(scope===workspaceId&&version===loadVersion)$('#source-feedback').textContent=e.message}
  };
  function passwordHint(){
    const same=editing&&editing.host===field('host').value.trim()&&editing.port===Number(field('port').value)&&editing.username===field('username').value.trim();
    $('#source-password-state').textContent=same?'密码已保存，留空保留，填写新值可替换。':'请输入 SSH 密码；更换服务器、端口或账号后不会沿用旧密码。';
    field('password').required=!same;
  }
  function addLogRow(rule={}){
    if($('#source-log-rows').children.length>=20){toast('最多添加 20 条日志规则');return;}
    const row=document.createElement('div');row.className='source-log-row';
    row.innerHTML=`<label>文件名或筛选规则<input data-log-path required maxlength="1000" placeholder="trx-console.log 或 *-console.log" value="${esc(rule.logPath||'')}"></label><label>对应服务（可选）<input data-log-service maxlength="80" pattern="[a-zA-Z0-9_.-]+" placeholder="自动识别" value="${esc(rule.service||'')}"></label><button type="button" class="text-button" aria-label="移除此日志规则">移除</button>`;
    row.querySelector('button').onclick=()=>row.remove();$('#source-log-rows').append(row);
  }
  $('#source-add-log').onclick=()=>addLogRow();
  $('#source-qa-logs').onclick=()=>{const rows=$('#source-log-rows');if(rows.children.length===1&&!rows.querySelector('[data-log-path]').value)rows.replaceChildren();addLogRow({logPath:'*-console.log'});};
  function open(source=null){
    if(saving||window.workspaceMutation||loadedScope!==workspaceId)return;
    editing=source;sourceScope=workspaceId;$('#source-form').reset();$('#source-dialog-title').textContent=source?'编辑日志数据源':'添加日志数据源';$('#source-workspace').textContent='所属空间：'+activeWorkspace.name;
    for(const name of ['name','service','host','port','username','environment'])if(source)field(name).value=source[name];
    field('directory').value=source?.logDirectory||'';$('#source-log-rows').replaceChildren();for(const rule of source?.logs||[{logPath:source?.logPath||'',service:source?.service||''}])addLogRow(rule);field('enabled').checked=source?.enabled??true;field('password').value='';$('#source-form-feedback').textContent='';passwordHint();$('#source-dialog').showModal();
  }
  $('#add-log-source').onclick=()=>open();
  ['host','port','username'].forEach(name=>field(name).addEventListener('input',passwordHint));
  function setBusy(value){saving=value;$('#log-query-dialog').querySelectorAll('button,input').forEach(el=>el.disabled=value);$('#source-dialog').querySelectorAll('button,input').forEach(el=>el.disabled=value);$('#remote-source-list').querySelectorAll('button').forEach(el=>{const source=sources.find(s=>s.id===el.dataset.id);el.disabled=value||(['test','search'].includes(el.dataset.sourceAction)&&!source?.enabled)})}
  $('#source-form').addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;
    const scope=sourceScope,body={action:'save',workspace:scope,id:editing?.id,name:field('name').value,service:field('service').value,host:field('host').value,port:Number(field('port').value),username:field('username').value,password:field('password').value,environment:field('environment').value,logDirectory:field('directory').value,logs:[...document.querySelectorAll('.source-log-row')].map(row=>({logPath:row.querySelector('[data-log-path]').value,service:row.querySelector('[data-log-service]').value})),enabled:field('enabled').checked};
    setBusy(true);$('#source-form-feedback').textContent='正在保存本机配置…';
    try{const rows=await request('POST',body,scope);if(scope===workspaceId){++loadVersion;sources=rows;render();$('#source-feedback').textContent='数据源已保存到本机，可点击“测试连接”验证 SSH 和日志读取权限。'}$('#source-dialog').close()}
    catch(e){$('#source-form-feedback').textContent=e.name==='TimeoutError'?'请求超时，请刷新核对保存状态后重试':e.message}
    finally{setBusy(false)}
  });
  $('#remote-source-list').addEventListener('click',async e=>{
    const button=e.target.closest('[data-source-action]');if(!button||saving||window.workspaceMutation||loadedScope!==workspaceId)return;
    const source=sources.find(s=>s.id===button.dataset.id);if(!source)return;
    if(button.dataset.sourceAction==='edit'){open(source);return;}
    if(button.dataset.sourceAction==='search'){openLogQuery(source);return;}
    const deleting=button.dataset.sourceAction==='delete';
    if(deleting&&!confirm('删除数据源“'+source.name+'”及其本机密码？远程日志文件不会删除。'))return;
    const scope=workspaceId,testing=button.dataset.sourceAction==='test';setBusy(true);
    $('#source-feedback').textContent=testing?'正在验证 SSH 登录与日志权限，最长约 2 分钟…':'正在保存配置…';
    try{const data=await request('POST',testing?{action:'test',workspace:scope,id:source.id}:{action:deleting?'delete':'toggle',workspace:scope,id:source.id,enabled:!source.enabled},scope,true);if(scope===workspaceId){++loadVersion;sources=data.sources;render();$('#source-feedback').textContent=testing?data.result.message+(data.saveWarning?'；'+data.saveWarning:''):deleting?'数据源已删除。':'数据源配置状态已保存。'}}
    catch(e){if(scope===workspaceId)$('#source-feedback').textContent=e.message}finally{setBusy(false)}
  });
  let querySource=null,queryScope='';
  function openLogQuery(source){
    querySource=source;queryScope=workspaceId;$('#log-query-form').reset();$('#log-query-source').textContent=activeWorkspace.name+' / '+source.name+' · '+(source.logs||[{logPath:source.logPath}]).map(r=>r.logPath).join('、');
    $('#log-query-feedback').textContent='输入交易流水号或消息 ID，按固定文本匹配；返回上下文可能含其他交易。';$('#log-query-output').textContent='';$('#log-query-dialog').showModal();
  }
  $('#log-query-dialog').addEventListener('cancel',e=>{if(saving)e.preventDefault()});
  $('#log-query-form').addEventListener('submit',async e=>{
    e.preventDefault();if(saving||!querySource)return;
    const scope=queryScope;setBusy(true);$('#log-query-feedback').textContent='正在读取服务器日志，最长约 2 分钟…';$('#log-query-output').textContent='';
    try{
      const data=await request('POST',{action:'search',workspace:scope,id:querySource.id,query:$('#log-query-keyword').value},scope,true);
      if(scope===workspaceId){sources=data.sources;render()}
      $('#log-query-output').textContent=data.result.output||'没有匹配记录。';
      $('#log-query-feedback').textContent=data.result.message+' · 每个文件最多 20 处匹配，上下文各 200 行 · 耗时 '+(data.result.durationMs/1000).toFixed(1)+' 秒'+(data.saveWarning?'；'+data.saveWarning:'');
    }catch(e){$('#log-query-feedback').textContent=e.name==='TimeoutError'?'请求超时，未取得完整结果，请重试':e.message}finally{setBusy(false)}
  });
})();
