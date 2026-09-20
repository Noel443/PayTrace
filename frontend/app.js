const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let transactions=[], current=null, feedbackStatus='', busy=false, historyRows=[],aiJob=null;
let workspaceId='card';
try{const saved=localStorage.getItem('paytrace.workspace');if(window.workspaceCatalog.some(w=>w.id===saved))workspaceId=saved}catch{}
let activeWorkspace=window.workspaceData.get(workspaceId),selectedCase=null;
$('#workspace-select').innerHTML=window.workspaceCatalog.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
$('#workspace-select').value=workspaceId;
$('#workspace-select').addEventListener('change',async e=>{
  if(busy){e.target.value=workspaceId;return}
  aiJob?.controller.abort();
  workspaceId=e.target.value;activeWorkspace=window.workspaceData.get(workspaceId);
  try{localStorage.setItem('paytrace.workspace',workspaceId)}catch{}
  current=null;selectedCase=null;feedbackStatus='';historyRows=[];resetHistoryFilters();$('#result').hidden=true;$('#result').replaceChildren();$('#empty').hidden=false;$('#error').hidden=true;
  view('workbench');await init();toast('已切换至'+activeWorkspace.name);
});
async function api(path,method='GET',body,scope=workspaceId){
  if(path==='/status'){
    if(location.protocol==='file:')return {enabled:false,model:'未配置',message:'真实 AI 需要通过 npm start 启动并访问本地地址'};
    try{const response=await fetch('/api/ai/status');if(!response.ok)throw Error();return await response.json()}catch{return {enabled:false,model:'未配置',message:'AI 服务不可用，请重新运行 npm start'}}
  }
  return window.demoApi(path,method,body,scope)
}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3000)}
function view(name){if(name!=='workbench')aiJob?.controller.abort();document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.view===name));$('#breadcrumb').textContent={workbench:'交易排查',history:'排查记录',settings:'服务配置'}[name];if(name==='history')loadHistory();if(name==='settings'){loadSettings();loadKnowledge();loadModelConfig();}if(name==='workbench')requestAnimationFrame(drawFlow)}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
function choose(id){if(busy)return;const t=transactions.find(t=>t.id===id);$('#transaction-id').value=t.id;$('#question').value=t.question;$('#error').hidden=true;selectedCase=t;$('#flow-title').textContent=(t.business||'交易')+'处理链路';drawFlow();$('#transaction-id').focus()}
async function init(){try{renderWorkspaceOverview();transactions=await api('/transactions');$('#case-count').textContent=transactions.length+' 个业务场景 · '+activeWorkspace.services.length+' 个关联服务';$('#samples').innerHTML=transactions.map(t=>`<button type="button" class="sample" data-tx="${esc(t.id)}">${esc(t.scenario)}</button>`).join('');$('#scenario-list').innerHTML=transactions.map((t,i)=>`<button type="button" class="scenario" data-tx="${esc(t.id)}"><span class="case-no">CASE / 0${i+1}</span><span class="arrow">↗</span><h3>${t.business?`<span class="case-business">${esc(t.business)}</span>`:''}${esc(t.scenario)}</h3><p>${esc(t.question)}</p><small>${esc(t.id)}</small></button>`).join('');document.querySelectorAll('[data-tx]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.tx)));choose(transactions[0].id);const status=await api('/status');$('#model-label').textContent=status.enabled?'AI 已配置 · '+status.model:'规则诊断 · AI 待配置';drawFlow()}catch(e){$('#error').textContent=e.message;$('#error').hidden=false}}
$('#investigate-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;aiJob?.controller.abort();busy=true;$('#run').disabled=true;$('#run').textContent='排查中…';$('#loading').hidden=false;$('#error').hidden=true;$('#result').hidden=true;$('#empty').hidden=true;try{current=await api('/investigations','POST',{transactionId:$('#transaction-id').value,question:$('#question').value});renderReport()}catch(e){$('#error').textContent=e.message;$('#error').hidden=false;$('#empty').hidden=false}finally{busy=false;$('#run').disabled=false;$('#run').innerHTML='开始排查 <span>↗</span>';$('#loading').hidden=true}});
function renderReport(){aiJob?.controller.abort();const r=reportForDisplay(current),t=r.transaction;feedbackStatus=r.feedback?.status||'';$('#empty').hidden=true;$('#result').hidden=false;$('#result').innerHTML=`<div class="result-heading"><div><h2>排查报告 <span class="tag ${r.diagnosis==='待核实'?'amber':''}">${esc(r.diagnosis)}</span></h2><p>${esc(new Date(r.createdAt).toLocaleString('zh-CN'))} · ${esc(r.mode)} · ${(r.durationMs/1000).toFixed(2)}s</p></div><button class="text-button" id="export">↓ 导出排查单</button></div>${PayTraceGraph.render(r)}${investigationPanel(r)}<div class="report-grid"><div><div class="facts">${[['交易流水号',t.id],['交易金额',t.currency+' '+t.amount],['业务状态',t.statusLabel||{SUCCESS:'支付成功',FAILED:'支付失败',PROCESSING:'处理中'}[t.status]||t.status],['商户',t.merchant],['渠道',t.channel],['渠道流水号',t.channelId],['交易时间',t.time],['业务环境',(r.workspaceName||'外卡支付')+' · 沙箱']].map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div><div class="conclusion ${r.diagnosis==='待核实'?'pending':''}"><span class="tag">诊断结论</span><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div><div class="section-title"><h2>日志证据</h2><span>${r.evidence.length} 条精确关联记录</span></div>${r.evidence.length?r.evidence.map(e=>`<details class="evidence" id="evidence-${esc(e.id)}"><summary><span class="tag">${esc(e.id)}</span><b>${esc(e.service)}</b><span>${esc(e.text.match(/event=(\S+)/)?.[1]||'日志记录')}</span><span class="location">${esc(e.file)}:${e.line}</span></summary><code class="log">${esc(e.text)}</code><p class="context-label">匹配标识：${esc(e.matchedBy)} · 下方相邻行仅为上下文，可能包含其他交易</p><pre>${esc(e.context)}</pre></details>`).join(''):'<p>没有找到可用日志证据。</p>'}${r.code.text?`<details class="evidence"><summary><span class="tag">CODE</span><b>通知重试策略</b><span class="location">${esc(r.code.version)}</span></summary><p>${esc(r.code.file)}</p><pre>${esc(r.code.text)}</pre></details>`:''}<div class="section-title"><h2>运营下一步</h2><span>人工确认后执行</span></div><ol class="actions">${r.actions.map(a=>`<li>${esc(a)}</li>`).join('')}</ol><div class="uncertainty"><b>仍需确认</b><br>${r.uncertainties.map(esc).join('<br>')}</div><div class="section-title"><h2 id="ai-section-title" tabindex="-1">AI 证据分析</h2><span id="ai-result-state">${esc({disabled:'待分析',completed:r.ai.model,failed:'调用失败'}[r.ai.status])}</span></div><p>点击后将本次交易信息、问题、匹配日志和已保存的 Markdown 发送给已配置的模型。不会读取本地代码仓库。</p><button class="primary" id="analyze-ai" type="button">${r.ai.status==='completed'?'重新分析':'AI 分析'}</button><button class="text-button" id="stop-ai" type="button" hidden>停止分析</button><p id="ai-progress" role="status"></p><div id="ai-live" class="ai-live" hidden><ol id="ai-stages" class="ai-stages"></ol><div id="ai-output-sections" class="ai-output-sections"></div><div id="ai-stream-text" class="ai-text"></div></div><div id="ai-saved-text" class="ai-text">${aiTextWithReferences(r)}</div>${r.ai.status==='completed'?`<p class="ai-metadata">${esc(r.ai.model||'已配置模型')}${r.ai.analyzedAt?' · '+esc(new Date(r.ai.analyzedAt).toLocaleString('zh-CN')):''}${Number.isFinite(r.ai.durationMs)?' · 耗时 '+(r.ai.durationMs/1000).toFixed(1)+' 秒':''} · 引用编号可点击查看</p>`:''}${r.ai.notice?`<p>${esc(r.ai.notice)}</p>`:''}<div class="feedback-bar"><h2>处理反馈</h2><div class="feedback-options">${['已解决','需要开发介入','判断不正确'].map(s=>`<button class="text-button ${feedbackStatus===s?'selected':''}" data-feedback="${s}">${s}</button>`).join('')}</div><label>处理备注<textarea id="feedback-note" maxlength="2000" placeholder="记录最终原因或需要继续核实的情况">${esc(r.feedback?.note||'')}</textarea></label><div class="feedback-submit"><button class="primary" id="save-feedback">保存反馈</button></div></div></div><aside class="report-side"><h3>排查过程</h3><div class="steps">${r.steps.map(s=>`<div class="step"><b>${esc(s.title)}</b><p>${esc(s.detail)}</p><small>${s.count} 项结果</small></div>`).join('')}</div><div class="side-section"><h3>本次问题</h3><p>${esc(r.question||'未填写问题描述')}</p></div><div class="side-section"><h3>数据与来源</h3><p>交易与日志：沙箱数据集<br>业务规则：${esc(r.repository?r.repository+' / master@'+r.commit.slice(0,8):'v1.0')}<br>基础诊断：规则分析</p><p>当前数据用于业务验证，未连接生产交易系统。</p></div></aside></div>`;
PayTraceGraph.current=r;PayTraceGraph.bind(r,{onEvidence:openEvidence,onAnalyze:()=>{$('#ai-section-title').scrollIntoView({behavior:'smooth',block:'start'});runAi(r)}});bindInvestigation(r);$('#analyze-ai').addEventListener('click',()=>runAi(r));$('#export').addEventListener('click',exportReport);document.querySelectorAll('[data-feedback]').forEach(b=>b.addEventListener('click',()=>{feedbackStatus=b.dataset.feedback;document.querySelectorAll('[data-feedback]').forEach(x=>x.classList.toggle('selected',x===b))}));$('#save-feedback').addEventListener('click',async()=>{if(!feedbackStatus)return toast('请先选择处理结果');$('#save-feedback').disabled=true;try{current=await api('/investigations/'+r.id+'/feedback','POST',{status:feedbackStatus,note:$('#feedback-note').value});toast('反馈已保存')}catch(e){toast(e.message)}finally{$('#save-feedback').disabled=false}})}
function exportReport(){const r=reportForDisplay(current);const text=`# 支付交易排查单\n\n交易：${r.transaction.id}\n商户：${r.transaction.merchant}\n时间：${r.createdAt}\n问题：${r.question}\n诊断方式：${r.mode}${investigationMarkdown(r)}\n\n## ${r.title}\n${r.summary}\n\n## 证据\n${r.evidence.map(e=>`- [${e.id}] ${e.service} ${e.file}:${e.line}\n  ${e.text}`).join('\n')}\n\n## 操作建议\n${r.actions.map((a,i)=>`${i+1}. ${a}`).join('\n')}\n\n## 待确认\n${r.uncertainties.join('\n')}\n\n## AI 补充分析（需人工复核）\n${r.ai.text}\n\n## 处理反馈\n${r.feedback?.status||'未反馈'}\n${r.feedback?.note||''}\n`;const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=r.transaction.id+'-排查单.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function loadHistory(){
  const scope=workspaceId;
  try{const rows=await api('/investigations','GET',undefined,scope);if(scope!==workspaceId)return;historyRows=rows;renderHistory()}
  catch(e){toast(e.message)}
}
function resetHistoryFilters(){
  $('#history-search').value='';$('#history-feedback').value='all';$('#history-ai').value='all';
}
function renderHistory(){
  const query=$('#history-search').value.trim().toLocaleLowerCase();
  const feedback=$('#history-feedback').value,ai=$('#history-ai').value;
  const rows=historyRows.filter(r=>{
    const haystack=[r.transaction.id,r.transaction.merchant,r.title,r.question].join(' ').toLocaleLowerCase();
    return (!query||haystack.includes(query))&&(feedback==='all'||(r.feedback?.status||'未反馈')===feedback)&&(ai==='all'||(ai==='completed')===(r.ai?.status==='completed'));
  });
  $('#history-summary').innerHTML=[['排查记录',historyRows.length],['待反馈',historyRows.filter(r=>!r.feedback?.status).length],['已解决',historyRows.filter(r=>r.feedback?.status==='已解决').length],['AI 已分析',historyRows.filter(r=>r.ai?.status==='completed').length]].map(([label,count])=>`<div><span>${label}</span><b>${count}</b></div>`).join('');
  $('#history-count').textContent=activeWorkspace.name+' · 当前显示 '+rows.length+' / '+historyRows.length+' 条记录';
  $('#history-list').innerHTML=rows.length?`<div class="table-scroll"><table class="history-table"><thead><tr><th>交易流水号 / 商户</th><th>排查结论</th><th>创建时间</th><th>处理状态</th><th>AI 分析</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-report="${esc(r.id)}" tabindex="0"><td>${esc(r.transaction.id)}<small class="history-merchant">${esc(r.transaction.merchant)}</small></td><td>${esc(r.title)}</td><td>${esc(new Date(r.createdAt).toLocaleString('zh-CN'))}</td><td><span class="tag ${r.feedback?.status==='已解决'?'':'amber'}">${esc(r.feedback?.status||'待反馈')}</span></td><td>${r.ai?.status==='completed'?'已分析':'未分析'}</td><td>↗</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-history">${historyRows.length?'没有符合筛选条件的记录，请调整搜索条件。':'当前工作空间还没有排查记录。'}</div>`;
  document.querySelectorAll('[data-report]').forEach(el=>{
    const open=()=>{current=rows.find(r=>r.id===el.dataset.report);view('workbench');renderReport();$('#transaction-id').value=current.transaction.id;$('#question').value=current.question};
    el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter')open()});
  });
}
$('#history-search').addEventListener('input',renderHistory);
$('#history-feedback').addEventListener('change',renderHistory);
$('#history-ai').addEventListener('change',renderHistory);
$('#history-reset').addEventListener('click',()=>{resetHistoryFilters();renderHistory()});
async function loadSettings(){try{const services=await api('/services');$('#service-list').innerHTML=services.map(s=>`<div class="service" data-service="${esc(s.name)}"><div><h3>${esc(s.name)}</h3><p>${esc(s.role||activeWorkspace.services.find(x=>x.name===s.name)?.role||'业务服务')} · ${esc(s.version||activeWorkspace.commit.slice(0,8)||'v1.0')}</p></div><label>日志文件<input value="${esc(s.logFile)}" readonly></label><label class="switch"><input type="checkbox" ${s.enabled?'checked':''}>启用</label></div>`).join('');}catch(e){toast(e.message)}}
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const body=[...document.querySelectorAll('[data-service]')].map(el=>({name:el.dataset.service,logFile:el.querySelector('input[readonly]').value,enabled:el.querySelector('input[type=checkbox]').checked}));try{await api('/services','PUT',body);toast('服务配置已保存')}catch(e){toast(e.message)}});
function drawFlow(){const canvas=$('#flow-canvas');if(!canvas||$('#empty').hidden||$('#workbench').hidden)return;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);const labels=selectedCase?.pipeline?.map(p=>p.label)||activeWorkspace.flow||activeWorkspace.cases[0].pipeline.map(p=>p.label);const gap=(w-48)/(labels.length-1),y=h/2-8;c.strokeStyle='#cddfdb';c.lineWidth=1;c.beginPath();c.moveTo(24,y);c.lineTo(w-24,y);c.stroke();labels.forEach((label,i)=>{const x=24+gap*i;c.fillStyle=i===3?'#e8bb66':'#148875';c.beginPath();c.arc(x,y,6,0,Math.PI*2);c.fill();c.fillStyle='#f7f9fa';c.beginPath();c.arc(x,y,2,0,Math.PI*2);c.fill();c.fillStyle='#627b7d';c.font='11px -apple-system, sans-serif';c.textAlign=i===0?'left':i===labels.length-1?'right':'center';c.fillText(label,x,y+29);if(i<labels.length-1){c.fillStyle='#9abcb3';c.textAlign='center';c.fillText('›',x+gap/2,y+4)}})}
window.addEventListener('resize',drawFlow);init();

function syncKnowledgeMode(){
  const enabled=$('#scan-enabled').checked;
  $('#repository-config').hidden=!enabled;
  $('#knowledge-mode').textContent=enabled?'代码扫描已选择：保存后供未来后端使用，当前尚未扫描。Markdown 文档可作为补充。':'仅使用 Markdown 文档：不触发代码扫描。';
  document.querySelectorAll('#project-list input').forEach(input=>input.disabled=!enabled);
}
function addProjectRow(project={name:'',path:'',branch:'master'}){
  const row=document.createElement('div');row.className='project-row';
  row.innerHTML=`<label>项目名称<input data-field="name" required maxlength="100" placeholder="例如：外卡 trx" value="${esc(project.name)}"></label><label>本地仓库路径<input data-field="path" required maxlength="1000" placeholder="/path/to/project" value="${esc(project.path)}"></label><label>扫描分支<input data-field="branch" maxlength="200" placeholder="master" value="${esc(project.branch)}"></label><button type="button" class="text-button remove-project">移除</button>`;
  row.querySelector('button').addEventListener('click',()=>row.remove());$('#project-list').append(row);syncKnowledgeMode();
}
function showKnowledgeSaved(k){$('#knowledge-saved').textContent=k.updatedAt?'已保存到本地 · '+new Date(k.updatedAt).toLocaleString('zh-CN'):(k.markdown?'已载入业务文档 · 修改后请保存':'尚未保存文档')}
function markKnowledgeDirty(){$('#knowledge-saved').textContent='有未保存的修改，请点击「保存知识配置」'}
async function loadKnowledge(){try{const k=await api('/knowledge');$('#scan-enabled').checked=k.scanEnabled;$('#knowledge-markdown').value=k.markdown;$('#project-list').replaceChildren();k.projects.forEach(addProjectRow);syncKnowledgeMode();showKnowledgeSaved(k)}catch(e){toast(e.message)}}
$('#knowledge-form').addEventListener('input',markKnowledgeDirty);
$('#knowledge-form').addEventListener('click',e=>{if(e.target.closest('#add-project, .remove-project'))markKnowledgeDirty()});
$('#download-markdown').addEventListener('click',()=>{const text=$('#knowledge-markdown').value;if(!text.trim())return toast('请先填写或导入 Markdown 文档');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='PayTrace-业务知识.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('#scan-enabled').addEventListener('change',syncKnowledgeMode);
$('#add-project').addEventListener('click',()=>addProjectRow());
$('#markdown-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(!/\.(md|markdown)$/i.test(file.name))throw Error('请选择 Markdown 文件');if(file.size>400000)throw Error('文档过大，请选择 400 KB 以内的文件');const text=await file.text();if(text.length>100000)throw Error('文档请控制在 10 万字以内');$('#knowledge-markdown').value=text;markKnowledgeDirty();toast('文档已导入，请保存知识配置')}catch(error){toast(error.message)}finally{e.target.value=''}
});
$('#knowledge-form').addEventListener('submit',async e=>{
  e.preventDefault();const projects=[...document.querySelectorAll('.project-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))).filter(p=>p.name.trim()||p.path.trim());
  try{const k=await api('/knowledge','PUT',{scanEnabled:$('#scan-enabled').checked,projects,markdown:$('#knowledge-markdown').value});showKnowledgeSaved(k);toast('文档与配置已保存到当前浏览器')}catch(error){toast(error.message)}
});

function openEvidence(id){
  const target=document.getElementById('evidence-'+id);if(!target)return;
  target.open=true;target.scrollIntoView({behavior:'smooth',block:'center'});target.querySelector('summary').focus();
  target.classList.remove('evidence-highlight');void target.offsetWidth;target.classList.add('evidence-highlight');
}
async function runAi(report){
  const reportWorkspace=report.workspaceId||'card',button=$('#analyze-ai'),progress=$('#ai-progress');
  if(aiJob){toast('当前分析仍在进行，可先停止后重试');return;}
  if(location.protocol==='file:'){progress.textContent='请先运行 npm start，再打开 http://127.0.0.1:5173 使用真实 AI';return;}
  const job={controller:new AbortController()},started=performance.now(),revision=report.revision??0;
  aiJob=job;
  const stop=$('#stop-ai'),live=$('#ai-live'),output=$('#ai-stream-text'),stages=$('#ai-stages'),sections=$('#ai-output-sections'),graphButton=$('#graph-ai');
  button.disabled=true;if(graphButton)graphButton.disabled=true;stop.hidden=false;$('#ai-result-state').textContent='分析中';$('#ai-saved-text').hidden=report.ai.status!=='completed';stop.onclick=()=>job.controller.abort();
  live.hidden=false;live.classList.remove('is-incomplete');output.textContent='';sections.replaceChildren();stages.replaceChildren();
  live.onclick=e=>{const reference=e.target.closest('[data-evidence]');if(reference)openEvidence(reference.dataset.evidence)};
  const stage=(phase,message)=>{
    let item=stages.querySelector('[data-phase="'+phase+'"]');
    if(!item){item=document.createElement('li');item.dataset.phase=phase;stages.append(item)}
    item.textContent=message;progress.textContent=message;
  };
  stage('preparing','正在整理本次交易证据…');
  const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(65000)]);
  let text='',result=null;const cited=new Set();
  try{
    const knowledge=await api('/knowledge','GET',undefined,reportWorkspace);
    signal.throwIfAborted();
    const response=await fetch('/api/ai/analyze/stream',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({report,markdown:knowledge.markdown})});
    if(!response.ok){let error;try{error=await response.json()}catch{}throw Error(error?.message||'AI 服务不可用，请重新启动 npm start')}
    if(!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('本地服务版本不支持流式分析，请重启 npm start');
    await PayTraceStream.readEvents(response,'sse',event=>{
      signal.throwIfAborted();
      let data;try{data=JSON.parse(event.data)}catch{throw Error('AI 响应格式无效')}
      if(event.event==='error')throw Error(data.message||'分析中断');
      if(event.event==='stage'){
        if(data.phase==='prepared'){stages.replaceChildren();stage('prepared',data.message)}
        else if(['connecting','receiving'].includes(data.phase))stage(data.phase,data.message);
        if(data.model&&$('#ai-result-state'))$('#ai-result-state').textContent='分析中 · '+data.model;
      }
      if(event.event==='delta'){
        if(typeof data.text!=='string'||text.length+data.text.length>30000)throw Error('AI 输出格式或长度无效');
        text+=data.text;
        output.innerHTML=aiTextWithReferences({...report,ai:{text}});
        const headings=['已确认事实','可能原因','待核实事项','运营下一步'];
        sections.innerHTML=headings.map(title=>`<span class="${text.includes(title)?'received':''}">${text.includes(title)?'●':'○'} ${title}</span>`).join('');
        const newIds=[...text.matchAll(/\[(E\d+)\]/g)].map(m=>m[1]).filter(id=>!cited.has(id)&&report.evidence.some(e=>e.id===id));
        newIds.forEach(id=>cited.add(id));
        if(current?.id===report.id&&(current.revision??0)===revision)PayTraceGraph.highlight(newIds);
        progress.textContent='正在接收分析 · '+text.length+' 字 · '+cited.size+' 条证据引用';
      }
      if(event.event==='done'){
        if(data.status!=='completed'||data.text!==text||!text.trim())throw Error('分析完成校验失败，请重试');
        result=data;return false;
      }
    });
    signal.throwIfAborted();if(!result)throw Error('连接提前结束，本次分析未完成');
    stage('saving','分析已接收，正在保存报告…');
    result.durationMs=Math.round(performance.now()-started);result.revision=revision;
    const updated=await api('/investigations/'+report.id+'/ai','POST',result,reportWorkspace);
    aiJob=null;
    if(workspaceId===reportWorkspace&&current?.id===report.id){
      current=updated;const draft=$('#feedback-note')?.value||'',selected=feedbackStatus;
      renderReport();$('#feedback-note').value=draft;feedbackStatus=selected;
      document.querySelectorAll('[data-feedback]').forEach(b=>b.classList.toggle('selected',b.dataset.feedback===selected));
      $('#ai-progress').textContent='分析已完成并保存 · '+(result.durationMs/1000).toFixed(1)+' 秒 · '+cited.size+' 条证据引用';
    }
    toast(window.workspaceData.get(reportWorkspace).name+'：AI 分析已完成并保存');
  }catch(error){
    const message=job.controller.signal.aborted?'分析已停止':signal.aborted?'模型请求超过 65 秒':error.message;
    stage('failed',message+' · 本次未保存，原有报告保留');
    live.classList.add('is-incomplete');
    if(live.isConnected){$('#ai-saved-text').hidden=false;$('#ai-result-state').textContent=report.ai.status==='completed'?report.ai.model+' · 本次未完成':'未完成';}
    if(!job.controller.signal.aborted)toast('AI 分析未完成，原有报告已保留');
  }finally{
    if(aiJob===job)aiJob=null;
    button.disabled=false;if(graphButton)graphButton.disabled=false;stop.hidden=true;
  }
}

let loadedModel=null,modelStore={activeId:null,providers:[]},modelBusy=false;
async function modelRequest(endpoint,method='GET',body){
  if(location.protocol==='file:')throw Error('请运行 npm start，并通过 http://127.0.0.1:5173 配置模型');
  const response=await fetch('/api/ai/'+endpoint,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)});
  let data;try{data=await response.json()}catch{throw Error('本地模型服务不可用，请重启 npm start')}
  if(!response.ok)throw Error(data.message||'模型配置请求失败');return data;
}
function renderProviders(){
  $('#provider-list').innerHTML=modelStore.providers.length?modelStore.providers.map(p=>{
    const active=p.id===modelStore.activeId;
    return `<article class="provider-card ${active?'is-active':''}"><div class="provider-card-top"><div class="provider-icon" aria-hidden="true">${p.provider==='ollama'?'L':'AI'}</div><div class="provider-title"><h3>${esc(p.name)}</h3><span>${p.provider==='ollama'?'Ollama · 本地模型':'Chat Completions · 兼容接口'}</span></div><span class="provider-badge ${active?'active-badge':''}">${active?(p.enabled?'● 当前使用':'当前服务 · 待完善'):'备用'}</span></div><div class="provider-detail"><strong>${esc(p.model)}</strong><span title="${esc(p.base)}">${esc(p.base)}</span></div><div class="provider-card-bottom"><span class="provider-key">${p.provider==='ollama'?'本地连接 · 无需密钥':p.hasKey?'密钥已保存':'待配置密钥'}</span><div class="provider-buttons"><button type="button" class="text-button" data-model-action="test" data-model-id="${esc(p.id)}" ${!p.enabled?'disabled':''}>测试</button><button type="button" class="text-button" data-model-action="edit" data-model-id="${esc(p.id)}">编辑</button><button type="button" class="text-button delete-model" data-model-action="delete" data-model-id="${esc(p.id)}" ${active?'disabled title="请先切换到其他服务商"':''}>删除</button><button type="button" class="${active?'provider-current':'primary'}" data-model-action="activate" data-model-id="${esc(p.id)}" ${active||!p.enabled?'disabled':''}>${active?'已选用':'启用'}</button></div></div></article>`;
  }).join(''):'<div class="provider-empty"><h3>添加第一个模型服务</h3><p>接入云端兼容接口或本地 Ollama，开始使用 AI 辅助排查。</p><button class="text-button" type="button" data-model-action="add">＋ 添加服务商</button></div>';
}
function modelControls(busy){
  modelBusy=busy;
  $('#model-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=busy);
  $('#close-model').disabled=busy;$('#add-model').disabled=busy;
  if(busy)$('#provider-list').querySelectorAll('button').forEach(el=>el.disabled=true);else renderProviders();
}
function refreshModelStatus(){
  const active=modelStore.providers.find(p=>p.id===modelStore.activeId);
  $('#model-label').textContent=active?.enabled?'AI 已配置 · '+active.model:'规则诊断 · AI 待配置';
  $('#model-status').textContent=active?active.name+' / '+active.model+(active.enabled?' · 已配置，连接以测试结果为准':' · 请完善配置'):'尚未启用模型服务';
}
function syncModelForm(){
  const ollama=$('#ai-provider').value==='ollama';
  $('#ai-key-label').hidden=ollama;$('#ai-clear-label').hidden=ollama||!loadedModel?.hasKey;
  $('#ai-address-help').textContent=ollama?'默认地址 http://127.0.0.1:11434，需提前运行 Ollama 并安装模型。':'在根地址后追加 /chat/completions；如需 /v1，请包含在地址中。';
  const same=loadedModel&&loadedModel.provider===$('#ai-provider').value&&loadedModel.base===$('#ai-base').value.trim().replace(/\/+$/,'');
  $('#ai-key-state').textContent=ollama?'本地 Ollama 无需 API Key。':same&&loadedModel.hasKey?'密钥已保存，留空保留，输入新值可替换。':'请输入 API Key，更换地址后需重新填写。';
}
async function loadModelConfig(){
  if(modelBusy)return;
  $('#add-model').disabled=true;$('#provider-feedback').textContent='正在读取本机配置…';
  try{modelStore=await modelRequest('providers');renderProviders();refreshModelStatus();$('#add-model').disabled=false;$('#provider-feedback').textContent=''}
  catch(e){$('#provider-list').innerHTML='';$('#provider-feedback').textContent=e.message}
}
function openModel(id){
  if(modelBusy)return;
  loadedModel=modelStore.providers.find(p=>p.id===id)||null;
  $('#model-form').reset();$('#model-dialog-title').textContent=loadedModel?'编辑服务商':'添加服务商';
  $('#model-presets').hidden=!!loadedModel;
  $('#ai-name').value=loadedModel?.name||'';$('#ai-provider').value=loadedModel?.provider||'compatible';
  $('#ai-base').value=loadedModel?.base||'';$('#ai-model').value=loadedModel?.model||'';
  $('#ai-activate').checked=loadedModel?loadedModel.id===modelStore.activeId:!modelStore.activeId;
  $('#model-feedback').textContent='';syncModelForm();$('#model-dialog').showModal();$('#ai-name').focus();
}
$('#add-model').addEventListener('click',()=>openModel());
$('#close-model').addEventListener('click',()=>$('#model-dialog').close());
$('#model-dialog').addEventListener('cancel',e=>{if(modelBusy)e.preventDefault()});
$('#model-dialog').addEventListener('close',()=>{$('#ai-key').value=''});
$('#model-presets').addEventListener('click',e=>{
  const preset=e.target.closest('[data-preset]')?.dataset.preset;if(!preset)return;
  const values={custom:['','compatible','',''],deepseek:['DeepSeek','compatible','https://api.deepseek.com','deepseek-chat'],qwen:['通义千问','compatible','https://dashscope.aliyuncs.com/compatible-mode/v1','qwen-plus'],ollama:['Ollama','ollama','http://127.0.0.1:11434','qwen3:8b']}[preset];
  ['ai-name','ai-provider','ai-base','ai-model'].forEach((id,i)=>$('#'+id).value=values[i]);$('#ai-key').value='';$('#ai-clear').checked=false;syncModelForm();$('#model-feedback').textContent='已填入参考配置，请按实际服务和模型调整。';
});
$('#ai-provider').addEventListener('change',()=>{if($('#ai-provider').value==='ollama')$('#ai-base').value='http://127.0.0.1:11434';else if($('#ai-base').value==='http://127.0.0.1:11434')$('#ai-base').value='';$('#ai-key').value='';$('#ai-clear').checked=false;syncModelForm()});
$('#ai-base').addEventListener('input',syncModelForm);
$('#ai-clear').addEventListener('change',()=>{if($('#ai-clear').checked)$('#ai-activate').checked=false});
$('#model-form').addEventListener('input',()=>$('#model-feedback').textContent='配置已修改，尚未保存。');
async function submitModel(test){
  if(modelBusy||!$('#model-form').reportValidity())return;
  const body={action:'save',id:loadedModel?.id,name:$('#ai-name').value,provider:$('#ai-provider').value,base:$('#ai-base').value,model:$('#ai-model').value,key:$('#ai-key').value,clearKey:$('#ai-clear').checked,activate:$('#ai-activate').checked};
  modelControls(true);$('#model-feedback').textContent=test?'正在测试连接，最长等待约 60 秒…':'正在保存本机配置…';
  try{
    const result=await modelRequest(test?'test':'providers','POST',body);
    if(test)$('#model-feedback').textContent=result.message;
    else{modelStore=result;refreshModelStatus();$('#model-dialog').close();$('#provider-feedback').textContent='服务商已保存'+(body.activate?'，当前连接已生效。':'。');}
  }catch(e){$('#model-feedback').textContent=e.name==='TimeoutError'?'请求超时，请刷新列表核对状态后重试。':e.message}
  finally{modelControls(false)}
}
$('#test-model').addEventListener('click',()=>submitModel(true));
$('#model-form').addEventListener('submit',e=>{e.preventDefault();submitModel(false)});
$('#provider-list').addEventListener('click',async e=>{
  const button=e.target.closest('[data-model-action]');if(!button||modelBusy)return;
  const action=button.dataset.modelAction,id=button.dataset.modelId;
  if(action==='edit'||action==='add'){openModel(id);return;}
  const entry=modelStore.providers.find(p=>p.id===id);
  if(action==='delete'&&!confirm('删除服务商“'+entry.name+'”及其本机密钥？'))return;
  modelControls(true);$('#provider-feedback').textContent=action==='test'?'正在测试“'+entry.name+'”，最长等待约 60 秒…':'正在更新配置…';
  try{
    const result=await modelRequest(action==='test'?'test':'providers','POST',action==='test'?{id,savedOnly:true}:{id,action});
    if(action==='test')$('#provider-feedback').textContent=entry.name+'：'+result.message;
    else{modelStore=result;refreshModelStatus();$('#provider-feedback').textContent=action==='activate'?'已切换至“'+entry.name+'”，后续分析使用该连接。':'服务商已删除。'}
  }catch(e){$('#provider-feedback').textContent=e.name==='TimeoutError'?'请求超时，请刷新列表核对状态后重试。':e.message}
  finally{modelControls(false)}
});

function investigationPanel(r){
  if(r.pipeline)return businessPipelinePanel(r);
  const m=window.investigation.inspect(r);
  const refs=ids=>ids.map(id=>id==='交易记录'?'<span class="tag">交易记录</span>':`<button class="evidence-link" type="button" data-evidence="${esc(id)}">[${esc(id)}] 查看证据</button>`).join(' ');
  return `<section class="investigation-panel" aria-label="支付状态分歧地图"><div class="section-title"><h2>支付状态分歧地图</h2><span>三个视角 · 同一笔交易</span></div><div class="party-grid">${m.parties.map((p,i)=>`<article class="party ${i===2?'merchant-party':''}"><small>0${i+1} / ${esc(p.name)}</small><h3>${esc(p.state)}</h3><p>${esc(p.detail)}</p>${refs(p.refs)}</article>`).join('')}</div><p class="map-caption">${r.supplement?(r.supplement.outcome==='completed'?'订单完成状态已对齐；通知确认问题仍未闭环。':'已观察到平台与商户状态分歧；具体原因仍待取证。'):'先区分各方事实，再核实未知状态；缺失证据不等于业务失败。'}</p><details class="event-timeline"><summary>展开交易时间线 · ${r.evidence.length} 条证据</summary><ol>${r.evidence.map(e=>`<li><time>${esc(e.text.split(' ')[0])}</time><span>${esc(e.service)} / ${esc(e.text.match(/event=(\S+)/)?.[1]||'记录')}</span>${refs([e.id])}</li>`).join('')}</ol></details><div class="next-evidence"><span class="tag">下一步取证 · 规则推荐</span><h3>${esc(m.next)}</h3><p>${r.supplement?'商户查单已补齐，继续核查剩余证据缺口；当前结果仍不能单独确定根因。':m.canSupplement?'这一步可以区分“商户未完成订单”和“已完成但通知未确认”，比继续重复查支付结果更有助于缩小范围。':'取得对应系统的新证据后再确认原因；当前案例仅展示取证建议。'}</p>${m.canSupplement?`<ul class="hypotheses">${m.hypotheses.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>${r.supplement?`<p class="supplement-receipt">已加入 [${esc(r.supplement.id)}] · ${esc(r.supplement.source)}<br>补入时间：${esc(new Date(r.supplement.addedAt).toLocaleString('zh-CN'))}。重新发起排查可核实其他状态。</p>`:`<fieldset class="supplement-options"><legend>选择商户查单结果（沙箱预设）</legend><label><input type="radio" name="merchant-outcome" value="completed" checked>商户订单已完成</label><label><input type="radio" name="merchant-outcome" value="pending">商户订单仍待支付</label></fieldset><button type="button" class="primary" id="add-supplement">补充证据并更新结论 ↗</button><p id="supplement-progress" role="status"></p>`}`:''}</div>${r.original?`<div class="conclusion-change" tabindex="-1" id="conclusion-change"><h3>新增证据如何改变结论</h3><div><article><small>补证前</small><b>${esc(r.original.title)}</b><p>${esc(r.original.summary)}</p></article><article><small>补证后 · [${esc(r.supplement.id)}]</small><b>${esc(r.title)}</b><p>${esc(r.summary)}</p></article></div><details><summary>查看补证前的处理建议与待确认事项</summary><ul>${[...r.original.actions,...r.original.uncertainties].map(a=>`<li>${esc(a)}</li>`).join('')}</ul></details></div>`:''}</section>`;
}
function bindInvestigation(r){
  document.querySelectorAll('[data-evidence]').forEach(b=>b.addEventListener('click',()=>openEvidence(b.dataset.evidence)));
  $('#add-supplement')?.addEventListener('click',async()=>{
    const button=$('#add-supplement'),progress=$('#supplement-progress');button.disabled=true;
    const note=$('#feedback-note').value,selected=feedbackStatus;
    try{
      const updated=await api('/investigations/'+r.id+'/supplement','POST',{outcome:$('input[name="merchant-outcome"]:checked').value,revision:r.revision??0});
      if(current?.id!==r.id)return;
      current=updated;renderReport();$('#feedback-note').value=note;feedbackStatus=selected;
      document.querySelectorAll('[data-feedback]').forEach(b=>b.classList.toggle('selected',b.dataset.feedback===selected));
      $('#conclusion-change').focus();toast('补充证据已保存，结论与建议已更新');
    }catch(e){progress.textContent=e.message;button.disabled=false}
  });
}
function investigationMarkdown(r){
  if(r.pipeline)return `\n\n## 工作空间与业务链路\n${r.workspaceName} / ${r.transaction.business}\n${r.pipeline.map(p=>p.label+'（'+p.service+' / '+p.detail+'）').join(' → ')}\n\n## 代码来源（静态审阅）\n${r.repository} / master / ${r.commit}\n${r.sources.map(s=>'- '+s.file+':'+s.line+' / '+s.symbol+'：'+s.note).join('\n')}\n交易与日志为沙箱预设，代码来源不代表运行时已执行。` ;
  const m=window.investigation.inspect(r);
  return `\n\n## 支付状态分歧地图\n${m.parties.map(p=>`- ${p.name}：${p.state}。${p.detail} ${p.refs.map(id=>'['+id+']').join(' ')}`).join('\n')}\n\n## 下一步取证（规则推荐）\n${m.next}\n${m.canSupplement?m.hypotheses.join('\n'):''}${r.original?`\n\n## 补证记录与结论变化\n来源：${r.supplement.source}\n证据：[${r.supplement.id}]\n查询时点：${r.supplement.observedAt}\n补入时间：${r.supplement.addedAt}\n补证前：${r.original.title}\n${r.original.summary}\n原建议：\n${r.original.actions.join('\n')}\n原待确认：\n${r.original.uncertainties.join('\n')}\n补证后：${r.title}\n${r.summary}`:''}`;
}

function reportForDisplay(report){
  const r=structuredClone(report);
  r.workspaceName=window.workspaceData.get(r.workspaceId||'card').name;
  const replacements=[["海风跨境 · 演示商户", "海风跨境"], ["北辰出海 · 演示商户", "北辰出海"], ["Worldpay · 模拟", "Worldpay"], ["未找到演示交易，请选择下方三个样例之一", "当前数据范围内未找到该交易，请选择业务案例或核对流水号"], ["在浏览器内的模拟交易数据中定位流水号", "按流水号定位交易记录"], ["匹配内置样例日志，排除其他交易干扰行", "匹配交易日志，排除其他交易干扰行"], ["关联模拟通知日志", "关联通知日志"], ["模拟交易与 trx 证据显示支付成功。", "交易记录与 trx 证据显示支付成功。"], ["演示策略：3 次未确认后进入人工复核", "3 次未确认后进入人工复核"], ["样例日志显示返回码 05（演示映射：Do not honor），模拟交易状态为失败。", "日志显示返回码 05（当前规则映射：Do not honor），交易状态为失败。"], ["模拟日志只证明", "日志仅证明"], ["形成模拟报告", "生成排查报告"], ["当前为前端预设诊断，未请求真实服务器或大模型", "依据关联证据与业务规则生成结论"], ["前端模拟诊断 · 未连接后端", "规则诊断 · 沙箱数据"], ["当前为纯前端原型，未接入 AI。以上结论由样例数据与预设规则生成。", "本报告尚未执行 AI 分析。可调用已配置的模型，对问题、证据和业务文档进行补充分析。"], ["未找到对应演示数据", "未找到对应数据"], ["依据平台留存的渠道响应样例，未直连渠道。", "依据留存的渠道响应记录，未直连渠道。"], ["依据模拟交易记录；商户订单状态独立核实。", "依据交易记录；商户订单状态独立核实。"], ["依据新增商户查单样例；仅代表该次查询时点。", "依据补充的查单记录；仅代表该次查询时点。"], ["新增商户查单样例", "新增商户查单记录"], ["当前案例暂不支持商户补证演示", "当前案例暂不支持商户补证"], ["本次排查已补证；请重新排查以演示另一分支", "本次排查已补证；请重新发起排查以核实其他状态"], ["请选择有效的商户查单样例", "请选择有效的商户查单结果"], ["内置商户查单样例 · 非真实查询", "商户查单记录 · 沙箱预设"], ["补充商户查单样例", "补充商户查单记录"], ["按演示规则更新结论，未调用 AI", "按业务规则更新结论，未调用 AI"], ["demo-v1", "v1.0"]];
  const text=value=>typeof value==='string'?replacements.reduce((s,[from,to])=>s.split(from).join(to),value):value;
  for(const key of ['mode','summary'])r[key]=text(r[key]);
  for(const key of ['merchant','channel'])r.transaction[key]=text(r.transaction[key]);
  r.steps=r.steps.map(step=>({...step,title:text(step.title),detail:text(step.detail)}));
  if(r.code)r.code.version=text(r.code.version);
  if(r.ai?.status==='disabled')r.ai.text='本报告尚未执行 AI 分析。可调用已配置的模型，对问题、证据和业务文档进行补充分析。';
  return r;
}

function renderWorkspaceOverview(){
  const w=activeWorkspace;
  $('#workspace-repository').textContent=w.repository||'支付业务';
  $('#settings-workspace').textContent=w.name+' / 服务管理';
  $('#flow-note').textContent=w.repository?'业务步骤依据代码整理；cb_common 为共享模块，不是独立服务。':'同步受理与异步通知分别核实';
  $('#workspace-overview').innerHTML=`<div class="workspace-summary"><div><h2>${esc(w.name)}</h2><p>${esc(w.description)}</p></div><span class="tag">${w.businesses.length} 条业务线</span></div><div class="business-chips">${w.businesses.map(b=>`<span>${esc(b)}</span>`).join('')}</div>${w.repository?`<details class="workspace-origin"><summary>代码依据：${esc(w.repository)} · master · ${esc(w.commit.slice(0,8))}</summary><p>业务入口、分支与任务关系来自本次静态代码审阅。交易、金额及日志为沙箱预设，不代表真实执行记录。点击业务案例查看对应链路与来源文件。</p></details>`:'<p class="workspace-origin">渠道支付、平台交易与商户订单分别核实。</p>'}`;
}
function businessPipelinePanel(r){
  return `<section class="business-pipeline"><div class="section-title"><h2>${esc(r.transaction.business)} · 业务链路</h2><span>${esc(r.workspaceName)}</span></div><ol class="pipeline-nodes">${r.pipeline.map((p,i)=>`<li><span class="pipeline-number">${String(i+1).padStart(2,'0')}</span><h3>${esc(p.label)}</h3><p>${esc(p.service)}</p><small>${esc(p.detail)}</small></li>`).join('')}</ol><p>以上为代码中的业务路径，不表示每一步已执行。下方日志证据记录当前案例的已知进展。</p><div class="service-coverage">${[...new Set(r.pipeline.map(p=>p.service))].map(service=>{const evidence=r.evidence.filter(e=>e.service===service);return `<div><b>${esc(service)}</b><span>${evidence.length?'已关联 '+evidence.length+' 条记录':'当前无日志证据'}</span>${evidence.map(e=>`<button type="button" class="evidence-link" data-evidence="${esc(e.id)}">[${esc(e.id)}] ${esc(e.text.match(/event=(\S+)/)?.[1]||'记录')}</button>`).join('')}</div>`}).join('')}</div><details class="source-references"><summary>查看代码来源 · ${r.sources.length} 处依据</summary><p>${esc(r.repository)} / master / ${esc(r.commit)}<br>共享模块 cb_common 的调用发生在宿主服务内；消息与回调是异步路径。</p>${r.sources.map(s=>`<article><b>${esc(s.symbol)}</b><code>${esc(s.file)}:${s.line}</code><p>${esc(s.note)}</p></article>`).join('')}</details></section>`;
}

function aiTextWithReferences(r){
  const ids=new Set(r.evidence.map(e=>e.id));
  return esc(r.ai.text).replace(/\[(E\d+)\]/g,(match,id)=>ids.has(id)?`<button type="button" class="evidence-link ai-citation" data-evidence="${id}" aria-label="查看证据 ${id}">${match}</button>`:match).replace(/^#{1,3}[ \t]+(已确认事实|可能原因|待核实事项|运营下一步)[ \t]*$/gm,'<h4>$1</h4>');
}
