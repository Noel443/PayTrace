(() => {
  let projects=[],loadedScope='',loadVersion=0,overviewVersion=0,editing=null,editScope='',mutating=false,job=null;
  window.projectOperationBusy=()=>mutating||!!job;
  const field=name=>document.getElementById('managed-project-'+name);
  const status=text=>$('#project-operation-status').textContent=text;
  const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  async function request(body,scope=workspaceId,signal){
    if(location.protocol==='file:')throw Error('项目配置需要运行 npm start，通过本机页面访问');
    const response=await fetch('/api/projects'+(!body?'?workspace='+encodeURIComponent(scope):''),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(12000)});
    if(body?.action==='analyze'&&response.ok)return response;
    let data;try{data=await response.json()}catch{throw Error('项目服务不可用，请重启 npm start')}
    if(!response.ok)throw Error(data.message||'项目请求失败');return data.projects;
  }
  function controls(){
    const locked=mutating||!!job;
    $('#add-managed-project').disabled=locked||loadedScope!==workspaceId;
    $('#import-legacy-projects').disabled=locked||loadedScope!==workspaceId;
    $('#managed-project-list').querySelectorAll('button').forEach(b=>b.disabled=locked);
    $('#managed-project-dialog').querySelectorAll('button,input,select').forEach(b=>b.disabled=mutating);
    syncMode();
    $('#stop-project-analysis').disabled=!job||job.controller.signal.aborted;
  }
  function render(){
    $('#managed-project-list').innerHTML=projects.length?projects.map(p=>`<article class="remote-source-card"><div class="provider-heading"><div><h3>${esc(p.name)}</h3><p>${p.scanEnabled?(p.repoType==='remote'?'远程 Git 仓库':'本地 Git 仓库'):'Markdown 业务文档'}</p></div><span class="tag ${!p.analysis||p.analysisStale?'amber':''}">${p.analysisStale?'配置已更新 · 待重分析':p.analysis?'链路已保存':'待分析'}</span></div><dl><div><dt>${p.scanEnabled?'仓库 / 分支':'知识来源'}</dt><dd>${p.scanEnabled?esc(p.repoType==='remote'?p.remoteUrl:p.repoPath)+'<br>'+esc(p.branch):'当前工作空间已保存的 Markdown'}</dd></div>${p.focus?`<div><dt>分析重点</dt><dd>${esc(p.focus)}</dd></div>`:''}</dl><p class="source-check-status">${p.analysis?esc(date(p.analysis.analyzedAt))+' · '+esc(p.analysis.model)+' · '+p.analysis.chains.length+' 条业务链路':'保存配置后，点击下方按钮开始分析。'}</p><div class="model-actions"><button type="button" class="primary" data-project-action="analyze" data-id="${esc(p.id)}">AI 分析并保存</button><button type="button" class="text-button" data-project-action="edit" data-id="${esc(p.id)}">编辑配置</button><button type="button" class="text-button danger-action" data-project-action="delete" data-id="${esc(p.id)}">删除</button>${p.analysis?`<button type="button" class="text-button" data-project-action="overview" data-id="${esc(p.id)}">查看业务链路</button>`:''}</div></article>`).join(''):'<div class="workspace-empty"><h3>配置项目，建立业务链路</h3><p>添加项目后，可使用 Markdown 或指定分支的代码分析；结果会保存到当前空间概览。</p></div>';
    controls();
  }
  let overviewRows=[],overviewScope='',detailProject=null,detailScope='',selectedChain=0,selectedNode=0,returnView='workbench';
  function overview(rows){
    overviewRows=rows;overviewScope=workspaceId;
    const target=$('#project-overview-results');if(!target)return;
    const analyzed=rows.filter(p=>p.analysis);
    target.innerHTML=analyzed.length?`<div class="section-heading project-overview-heading"><h3>项目业务链路</h3><span class="tag">${analyzed.length} 个项目</span></div><div class="project-summary-list">`+analyzed.map(p=>`<article class="project-summary-row"><div><h3>${esc(p.name)}</h3><p>${esc(p.analysis.summary.split(/[。！？\n]/)[0])}</p>${p.analysisStale?'<small>配置已更新，当前为上次分析结果</small>':''}</div><button class="text-button" type="button" data-project-open="${esc(p.id)}">查看业务链路 ↗</button></article>`).join('')+'</div>':rows.length?'<p class="project-overview-empty">项目尚未分析。<button type="button" class="text-button" data-project-settings>前往项目配置</button></p>':'';
  }
  function openDetail(project,origin='workbench'){
    if(!project?.analysis)return;
    detailProject=project;detailScope=workspaceId;selectedChain=0;selectedNode=0;returnView=origin;
    renderDetail();view('project-detail');$('#project-detail-title').focus();window.scrollTo({top:0});
  }
  function renderDetail(){
    const p=detailProject;if(!p||detailScope!==workspaceId){$('#project-detail').replaceChildren();return;}
    const a=p.analysis,chain=a.chains[selectedChain],node=chain?.steps[selectedNode];
    $('#project-detail').innerHTML=`<button class="text-button detail-back" type="button" data-detail-back>← ${returnView==='settings'?'返回项目配置':'返回交易排查'}</button><div class="detail-heading"><div><p class="detail-eyebrow">${esc(activeWorkspace.name)} / 项目业务链路</p><h1 id="project-detail-title" tabindex="-1">${esc(p.name)}</h1><p>按业务分类浏览，选择节点查看职责与依据。</p></div><span class="tag ${p.analysisStale?'amber':''}">${p.analysisStale?'配置变更 · 待重新分析':'AI 静态分析'}</span></div><div class="detail-layout"><nav class="detail-categories" aria-label="业务分类"><h2>业务分类</h2>${a.chains.map((c,i)=>`<button type="button" data-detail-chain="${i}" aria-current="${i===selectedChain?'true':'false'}"><span>${esc(c.name)}</span><small>${c.steps.length} 个节点</small></button>`).join('')}</nav><section class="detail-canvas" aria-label="业务节点"><div class="detail-canvas-heading"><p class="detail-eyebrow">业务视图</p><h2>${esc(chain?.name||'暂无业务节点')}</h2><p>按功能分组展示，节点排列不表示调用顺序。</p></div><div class="detail-nodes">${(chain?.steps||[]).map((s,i)=>`<button class="detail-node" type="button" data-detail-node="${i}" aria-pressed="${i===selectedNode}"><span class="detail-node-icon" aria-hidden="true">◇</span><span><small>${esc(s.service)}</small><strong>${esc(s.label)}</strong></span><span class="detail-node-open" aria-hidden="true">↗</span></button>`).join('')}</div><p class="detail-footnote">当前分析仅包含节点引用，缺少明确的节点间调用证据，因此不绘制顺序箭头。</p></section><aside class="detail-inspector" aria-label="节点详情"><p class="detail-eyebrow">节点详情</p><h2>${esc(node?.label||'选择一个节点')}</h2>${node?`<span class="tag">${esc(node.service)}</span><h3>业务职责</h3><p>${esc(node.description)}</p><h3>代码与文档依据</h3>${node.evidenceIds.map(id=>{const source=a.sources.find(s=>s.id===id);return source?`<article class="detail-citation"><b>[${esc(id)}]</b><code>${esc(source.file)}</code><small>第 ${source.startLine}–${source.endLine} 行${source.truncated?' · 片段截断':''}</small></article>`:`<p>[${esc(id)}] 引用资料缺失</p>`}).join('')}<p class="detail-footnote">引用定位到本次读取的文件片段，不代表该节点在实际交易中已执行。</p>`:''}</aside></div><details class="detail-context"><summary>项目概述、分析范围与待确认事项</summary><p>${esc(a.summary)}</p><p>${esc(a.model)} · ${esc(date(a.analyzedAt))} · ${a.mode==='repository'?'分支 '+esc(a.branch)+' / commit '+esc(a.commit):'Markdown 文档快照'}</p><p>${esc(a.remoteUrl||a.repoPath||'')} · 已读取 ${a.coverage.read} / ${a.coverage.total} 份候选资料${a.coverage.truncated?'（部分采样）':''}</p>${a.uncertainties.length?'<h3>待确认事项</h3><ul>'+a.uncertainties.map(u=>'<li>'+esc(u)+'</li>').join('')+'</ul>':'<p>静态分析结果需结合运行日志核实。</p>'}</details>`;
  }
  $('#project-detail').addEventListener('click',e=>{
    if(e.target.closest('[data-detail-back]')){view(returnView);return;}
    if(detailScope!==workspaceId)return;
    const chain=e.target.closest('[data-detail-chain]'),node=e.target.closest('[data-detail-node]');
    if(chain){selectedChain=Number(chain.dataset.detailChain);selectedNode=0;renderDetail();$('#project-detail [data-detail-chain="'+selectedChain+'"]').focus();}
    if(node){selectedNode=Number(node.dataset.detailNode);renderDetail();$('#project-detail [data-detail-node="'+selectedNode+'"]').focus();}
  });
  window.clearProjectDetail=()=>{detailProject=null;detailScope='';overviewRows=[];overviewScope='';$('#project-detail').replaceChildren();};
  window.loadProjectSettings=async()=>{
    const scope=workspaceId,version=++loadVersion;loadedScope='';projects=[];render();
    if(!job)status('正在读取项目配置…');
    try{const rows=await request(null,scope);if(scope!==workspaceId||version!==loadVersion)return;projects=rows;loadedScope=scope;render();if(!job)status('项目配置和分析结果保存在本机，按工作空间隔离。')}
    catch(e){if(scope===workspaceId&&version===loadVersion)status(e.message)}
  };
  window.loadProjectOverview=async()=>{
    const scope=workspaceId,version=++overviewVersion;
    if(location.protocol==='file:')return;
    try{const rows=await request(null,scope);if(scope===workspaceId&&version===overviewVersion)overview(rows)}catch{if(scope===workspaceId&&version===overviewVersion&&$('#project-overview-results'))$('#project-overview-results').textContent='项目链路暂时无法加载，请确认本地服务已启动。'}
  };
  function accept(rows,scope){
    if(scope!==workspaceId)return;
    ++loadVersion;++overviewVersion;projects=rows;loadedScope=scope;render();overview(rows);
  }
  function syncMode(){
    const enabled=field('scan').checked;field('repository').hidden=!enabled;
    const remote=field('repo-type').value==='remote';
    field('local-fields').hidden=remote;field('remote-fields').hidden=!remote;field('remote-help').hidden=!remote;
    field('path').required=enabled&&!remote;field('path').disabled=mutating||!enabled||remote;
    field('url').required=enabled&&remote;field('url').disabled=mutating||!enabled||!remote;field('repo-type').disabled=mutating||!enabled;field('branch').disabled=mutating||!enabled;
    field('mode').textContent=enabled?(remote?'点击分析时，获取远程指定分支，读取代码后自动清理临时副本。':'点击分析时，读取指定本地分支已提交的代码。'):'只分析当前空间已保存的 Markdown，不读取仓库。';
  }
  function open(project=null){
    if(mutating||job||window.workspaceMutation||loadedScope!==workspaceId)return;
    editing=project;editScope=workspaceId;field('form').reset();field('title').textContent=project?'编辑项目':'添加项目';field('workspace').textContent='所属空间：'+activeWorkspace.name;
    for(const key of ['name','focus'])field(key).value=project?.[key]||'';
    field('scan').checked=project?.scanEnabled??false;field('path').value=project?.repoPath||'';field('repo-type').value=project?.repoType||'local';field('url').value=project?.remoteUrl||'';field('branch').value=project?.branch||'master';field('feedback').textContent='保存配置不会自动扫描或调用 AI。';syncMode();field('dialog').showModal();
  }
  $('#add-managed-project').onclick=()=>open();field('scan').onchange=syncMode;field('repo-type').onchange=syncMode;
  $('#close-managed-project').onclick=()=>{if(!mutating)field('dialog').close()};
  field('dialog').addEventListener('cancel',e=>{if(mutating)e.preventDefault()});
  field('form').addEventListener('submit',async e=>{
    e.preventDefault();if(mutating||job)return;
    const scope=editScope,body={action:'save',workspace:scope,id:editing?.id,name:field('name').value,scanEnabled:field('scan').checked,repoPath:field('path').value,repoType:field('repo-type').value,remoteUrl:field('repo-type').value==='remote'?field('url').value:'',branch:field('branch').value||'master',focus:field('focus').value};
    mutating=true;controls();field('feedback').textContent='正在保存项目配置…';
    try{accept(await request(body,scope),scope);field('dialog').close();if(scope===workspaceId)status('项目已保存。点击“AI 分析并保存”，生成当前项目的业务链路。')}
    catch(error){field('feedback').textContent=error.message}finally{mutating=false;controls()}
  });
  window.cancelProjectAnalysis=()=>{if(job){job.controller.abort();$('#project-analysis-progress').hidden=true;controls()}};
  $('#stop-project-analysis').onclick=()=>{window.cancelProjectAnalysis();status('已请求停止分析，正在确认保存状态…')};
  async function analyze(project){
    const scope=workspaceId,controller=new AbortController(),task={scope,controller};job=task;controls();
    const stages=$('#project-analysis-stages');stages.replaceChildren();$('#project-analysis-progress').hidden=false;$('#project-analysis-count').textContent='准备分析 '+project.name;status('正在分析 '+project.name+'，成功后保存到工作空间概览。');
    let completed=false,count=0;
    try{
      let markdown='';
      if(!project.scanEnabled){const k=await api('/knowledge','GET',undefined,scope);if(!k.updatedAt||k.usingDefault)throw Error('请先在下方保存 Markdown 业务文档，再进行项目分析');markdown=k.markdown}
      controller.signal.throwIfAborted();
      const response=await request({action:'analyze',workspace:scope,id:project.id,markdown},scope,controller.signal);
      await PayTraceStream.readEvents(response,'sse',({event,data})=>{
        controller.signal.throwIfAborted();const value=JSON.parse(data);
        if(event==='error')throw Error(value.message||'分析失败');
        if(event==='done'){completed=true;accept(value.projects,scope);if(scope===workspaceId)status('业务链路已保存，可在交易排查页的工作空间概览查看。');return false;}
        if(scope!==workspaceId)return;
        if(event==='stage'){const li=document.createElement('li');li.textContent=value.message;stages.append(li)}
        if(event==='delta'){count+=value.text.length;$('#project-analysis-count').textContent='已接收 '+count+' 字分析内容，完成后校验并保存。'}
      });
      if(!completed)throw Error('连接提前结束，请核对保存状态后重试');
    }catch(error){if(scope===workspaceId)status(controller.signal.aborted?'分析已停止；保留已保存的结果。':error.message+'。未完成的分析不会替换已有结果。')}
    finally{
      if(job===task){job=null;controls();if(scope===workspaceId){$('#project-analysis-progress').hidden=true;
        // A disconnect can race with the final atomic save; reconcile with the server.
        if(!completed){const version=loadVersion;try{const rows=await request(null,scope);if(version===loadVersion&&!job)accept(rows,scope)}catch{}}
      }}
    }
  }
  $('#managed-project-list').addEventListener('click',async e=>{
    const b=e.target.closest('[data-project-action]');if(!b||mutating||job||window.workspaceMutation||loadedScope!==workspaceId)return;
    const p=projects.find(p=>p.id===b.dataset.id);if(!p)return;
    if(b.dataset.projectAction==='delete'){
      if(!confirm('删除项目“'+p.name+'”及已保存的业务链路？不会删除 Git 仓库或工作空间文档。'))return;
      const scope=workspaceId;mutating=true;controls();
      try{accept(await request({action:'delete',workspace:scope,id:p.id},scope),scope);if(scope===workspaceId)status('项目及业务链路已删除。')}catch(error){if(scope===workspaceId)status(error.message)}finally{mutating=false;controls()}
      return;
    }
    if(b.dataset.projectAction==='edit')open(p);
    if(b.dataset.projectAction==='analyze')analyze(p);
    if(b.dataset.projectAction==='overview')openDetail(p,'settings');
  });
  $('#workspace-overview').addEventListener('click',e=>{
    if(e.target.closest('[data-project-settings]')){view('settings');$('#project-settings').scrollIntoView({behavior:'smooth'})}
    const b=e.target.closest('[data-project-open]');if(b&&overviewScope===workspaceId)openDetail(overviewRows.find(p=>p.id===b.dataset.projectOpen));
  });
  $('#import-legacy-projects').onclick=async()=>{
    if(mutating||job||window.workspaceMutation||loadedScope!==workspaceId)return;
    const scope=workspaceId;mutating=true;controls();let count=0,skipped=0;
    try{
      const k=await api('/knowledge','GET',undefined,scope),existing=await request(null,scope);let rows=existing;
      for(const p of k.projects){
        if(scope!==workspaceId)break;
        if(rows.some(r=>r.name===p.name)){skipped++;continue;}
        rows=await request({action:'save',workspace:scope,name:p.name,repoPath:p.path,branch:p.branch||'master',scanEnabled:!!k.scanEnabled,focus:''},scope);count++;accept(rows,scope);
      }
      if(scope===workspaceId)status(`已导入 ${count} 个项目，跳过 ${skipped} 个同名项目。导入不会自动扫描，点击项目卡片开始分析。`);
    }catch(e){if(scope===workspaceId)status(`已导入 ${count} 个项目；后续导入未完成：${e.message}`)}finally{mutating=false;controls()}
  };
  window.loadProjectOverview();
})();
