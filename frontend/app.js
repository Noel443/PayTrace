const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let transactions=[], current=null, feedbackStatus='', busy=false, historyRows=[],aiJob=null;
window.addEventListener('paytrace:logout',()=>{aiJob?.controller.abort();window.cancelProjectAnalysis?.();});
let workspaceId=window.workspaceCatalog[0].id;
try{const saved=localStorage.getItem('paytrace.workspace');if(window.workspaceCatalog.some(w=>w.id===saved))workspaceId=saved}catch{}
let historyPage=1,historyPageSize=10,historySelection=new Set(),historyDeleting=false;
let workspaceViewVersion=0;
let activeWorkspace=window.workspaceData.get(workspaceId),selectedCase=null;
$('#workspace-select').innerHTML=window.workspaceCatalog.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
$('#workspace-select').value=workspaceId;
async function switchWorkspace(id,targetView){
  if(busy||window.workspaceMutation){$('#workspace-select').value=workspaceId;return;}
  const switchVersion=++workspaceViewVersion;
  const visibleView=document.querySelector('.view:not([hidden])')?.id;
  const previousView=visibleView==='project-detail'?'workbench':visibleView||'workbench';window.clearProjectDetail?.();
  aiJob?.controller.abort();window.cancelProjectAnalysis?.();workspaceId=id;activeWorkspace=window.workspaceData.get(id);$('#workspace-select').value=id;
  try{localStorage.setItem('paytrace.workspace',workspaceId)}catch{}
  window.questionImages?.set();
  current=null;selectedCase=null;feedbackStatus='';historyRows=[];resetHistoryFilters();$('#result').hidden=true;$('#result').replaceChildren();$('#empty').hidden=false;$('#error').hidden=true;
  window.refreshWorkspaceActions?.();const initialization=init();view(targetView||previousView);await initialization;if(switchVersion!==workspaceViewVersion)return;toast('已切换至'+activeWorkspace.name);
}
$('#workspace-select').addEventListener('change',e=>switchWorkspace(e.target.value));

async function api(path,method='GET',body,scope=workspaceId){
  if(path==='/status'){
    if(location.protocol==='file:')return {enabled:false,model:'未配置',message:'真实 AI 需要通过 npm start 启动并访问本地地址'};
    try{const response=await fetch('/api/ai/status');if(!response.ok)throw Error();return await response.json()}catch{return {enabled:false,model:'未配置',message:'AI 服务不可用，请重新运行 npm start'}}
  }
  return window.localApi(path,method,body,scope)
}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3000)}
function view(name){if(name!=='workbench'){aiJob?.controller.abort();followupJob?.abort();}document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.view===name));$('#breadcrumb').textContent={workbench:'交易排查',history:'排查记录',settings:'服务配置','project-detail':'项目业务链路'}[name];if(name==='history')loadHistory();if(name==='settings'){loadKnowledge();loadModelConfig();window.loadLogSources?.();window.loadProjectSettings?.();}if(name==='workbench'){requestAnimationFrame(drawFlow);window.loadProjectOverview?.();}}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
function choose(id){if(busy)return;const t=transactions.find(t=>t.id===id);$('#question').value=t.id+'：'+t.question;$('#error').hidden=true;selectedCase=t;$('#flow-title').textContent=(t.business||'交易')+'处理链路';drawFlow();$('#question').focus()}
async function init(){const scope=workspaceId,version=workspaceViewVersion;try{renderWorkspaceOverview();const rows=await api('/transactions','GET',undefined,scope);if(scope!==workspaceId||version!==workspaceViewVersion)return;transactions=rows;$('#case-count').textContent=transactions.length?transactions.length+' 个业务场景':'请先配置真实数据来源';$('#samples').closest('.samples').hidden=!transactions.length;$('#samples').innerHTML=transactions.map(t=>`<button type="button" class="sample" data-tx="${esc(t.id)}">${esc(t.scenario)}</button>`).join('');$('#scenario-list').innerHTML=transactions.map((t,i)=>`<button type="button" class="scenario" data-tx="${esc(t.id)}"><span class="case-no">CASE / 0${i+1}</span><span class="arrow">↗</span><h3>${t.business?`<span class="case-business">${esc(t.business)}</span>`:''}${esc(t.scenario)}</h3><p>${esc(t.question)}</p><small>${esc(t.id)}</small></button>`).join('');document.querySelectorAll('[data-tx]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.tx)));$('#run').disabled=false;$('#flow-canvas').closest('.flow-band').hidden=!transactions.length;
if(transactions.length)choose(transactions[0].id);else{$('#question').value='';$('#scenario-list').innerHTML='<div class="workspace-empty"><h3>描述遇到的问题，开始 AI 排查</h3><p>配置并启用 AI 模型后，直接输入问题即可；AI 会识别其中的交易线索，也可上传截图辅助分析。</p><button type="button" class="primary" id="setup-workspace">配置数据源与业务文档</button></div>';$('#setup-workspace').onclick=()=>view('settings');}
const status=await api('/status');if(scope!==workspaceId||version!==workspaceViewVersion)return;$('#model-label').textContent=status.enabled?'AI 已配置 · '+status.model:'AI 待配置';drawFlow()}catch(e){$('#error').textContent=e.message;$('#error').hidden=false}}
let investigationController=null;
window.addEventListener('paytrace:logout',()=>investigationController?.abort());
$('#investigate-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  let images;try{images=window.questionImages?.get()||[]}catch(error){toast(error.message);return;}
  const scope=workspaceId,controller=new AbortController();investigationController=controller;
  busy=true;$('#run').disabled=true;$('#run').textContent='排查中…';$('#loading').hidden=false;$('#error').hidden=true;$('#result').hidden=true;$('#empty').hidden=true;
  $('#loading p').textContent='正在准备日志查询';
  const stop=document.createElement('button');stop.type='button';stop.className='text-button';stop.textContent='停止排查';stop.onclick=()=>controller.abort();$('#loading').append(stop);
  try{
    const knowledge=await api('/knowledge','GET',undefined,scope);
    const response=await fetch('/api/investigations/stream',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({workspace:scope,workspaceName:activeWorkspace.name,question:$('#question').value,images,markdown:knowledge.markdown||''})});
    if(!response.ok){const error=await response.json();throw Error(error.message||'排查请求失败');}
    let report;
    await PayTraceStream.readEvents(response,'sse',({event,data})=>{
      const value=JSON.parse(data);
      if(event==='error')throw Error(value.message);
      if(event==='stage')$('#loading p').textContent=value.message;
      if(event==='delta')$('#loading p').textContent='AI 正在生成排查结论…';
      if(event==='done'){report=value.report;return false;}
    });
    if(!report)throw Error('排查连接中断，请重试');
    report.images=images;current=report;renderReport();
    try{await api('/investigations','POST',report,scope)}catch(e){$('#error').textContent='报告已生成，但保存失败：'+e.message+'。请先导出报告。';$('#error').hidden=false;}
  }catch(e){$('#error').textContent=controller.signal.aborted?'排查已停止':e.message;$('#error').hidden=false;$('#empty').hidden=false;}
  finally{busy=false;investigationController=null;stop.remove();$('#run').disabled=false;$('#run').innerHTML='开始排查 <span aria-hidden="true">↑</span>';$('#loading').hidden=true;}
});
function renderRealReport(r){
  $('#empty').hidden=true;$('#result').hidden=false;
  $('#result').innerHTML=`<div class="result-heading"><div><h2>${esc(r.title)}</h2><p>${esc(r.workspaceName)} · ${esc(r.transaction.id)} · ${(r.durationMs/1000).toFixed(1)} 秒</p></div><button class="text-button" id="export-real">导出排查单</button></div><div class="section-title"><h2>AI 排查结果</h2><span>${esc(r.ai.model||({disabled:'未调用 AI',failed:'AI 调用失败'}[r.ai.status]||''))}</span></div><div class="ai-text" style="white-space:pre-wrap">${esc(r.ai.text)}</div><p>查询仅覆盖所配置的日志文件，每个文件最多匹配 20 处；关键词匹配仍需核实交易关联。金额及业务状态以业务系统为准。</p><div class="section-title"><h2>日志查询覆盖</h2></div>${r.coverage.map(c=>`<p><b>${esc(c.source)} · ${esc(c.environment)} · ${esc(c.file||'')}</b>：${c.status==='failed'?'查询失败 · '+esc(c.message):'取得 '+c.matches+' 条证据'+(c.truncated?' · 返回内容已截断':'')+(c.omitted?' · '+c.omitted+' 条因报告容量限制未纳入':'')+(c.attempts?' · 扩展范围 '+esc(c.attempts.join(' → '))+' 行':'')+(c.stopReason?' · '+esc(c.stopReason):'')+(c.contextError?' · '+esc(c.contextError):'')}</p>`).join('')}<div class="section-title"><h2>日志证据</h2><span>${r.evidence.length} 条关键词匹配记录</span></div>${r.evidence.map(e=>`<details class="evidence"><summary><span class="tag">${esc(e.id)}</span><b>${esc(e.source)} · ${esc(e.service)} · ${esc(e.environment)}</b><span>${esc(e.file)}:${e.line}</span></summary><pre>${esc(e.text)}</pre>${e.context?`<p>附近原文（需核实交易关联）</p><pre>${esc(e.context)}</pre>`:''}</details>`).join('')}<div class="feedback-bar"><h2>处理反馈</h2><select id="real-feedback">${['未反馈','已解决','需要开发介入','判断不正确'].map(v=>`<option ${r.feedback?.status===v?'selected':''}>${v}</option>`).join('')}</select><textarea id="real-note" maxlength="2000" placeholder="记录最终原因">${esc(r.feedback?.note||'')}</textarea><button class="primary" id="real-save">保存反馈</button><button class="text-button" id="real-retry">重新查询并分析</button></div>`;
  renderScreenshotReport(r);
  renderFollowup(r);
  $('#real-retry').onclick=()=>{$('#question').value=[r.searchQuery,r.question].filter(Boolean).join('：');window.questionImages?.set(r.images);$('#investigate-form').requestSubmit();};
  $('#real-save').onclick=async()=>{try{current=await api('/investigations/'+r.id+'/feedback','POST',{status:$('#real-feedback').value,note:$('#real-note').value},r.workspaceId);toast('反馈已保存')}catch(e){toast(e.message)}};
  $('#export-real').onclick=()=>{const text=`# 日志排查报告\n\n搜索标识：${r.transaction.id}\n问题：${r.question}\n\n${r.ai.text}${followupMarkdown(r)}${screenshotMarkdown(r)}\n\n## 查询覆盖\n${r.coverage.map(c=>JSON.stringify(c)).join('\n')}\n\n## 日志证据\n${r.evidence.map(e=>`[${e.id}] ${e.source} / ${e.environment} ${e.file}:${e.line}\n${e.text}\n${e.context||''}`).join('\n\n')}`;const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='排查报告.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
function renderReport(){if(current?.kind==='real'){renderRealReport(current);return;}aiJob?.controller.abort();const r=reportForDisplay(current),t=r.transaction;feedbackStatus=r.feedback?.status||'';$('#empty').hidden=true;$('#result').hidden=false;$('#result').innerHTML=`<div class="result-heading"><div><h2>排查报告 <span class="tag ${r.diagnosis==='待核实'?'amber':''}">${esc(r.diagnosis)}</span></h2><p>${esc(new Date(r.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · ${esc(r.mode)} · ${(r.durationMs/1000).toFixed(2)}s</p></div><button class="text-button" id="export">↓ 导出排查单</button></div>${PayTraceGraph.render(r)}${investigationPanel(r)}<div class="report-grid"><div><div class="facts">${[['交易流水号',t.id],['交易金额',t.currency+' '+t.amount],['业务状态',t.statusLabel||{SUCCESS:'支付成功',FAILED:'支付失败',PROCESSING:'处理中'}[t.status]||t.status],['商户',t.merchant],['渠道',t.channel],['渠道流水号',t.channelId],['交易时间',t.time],['业务环境',(r.workspaceName||'外卡支付')+' · 沙箱']].map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div><div class="conclusion ${r.diagnosis==='待核实'?'pending':''}"><span class="tag">诊断结论</span><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div><div class="section-title"><h2>日志证据</h2><span>${r.evidence.length} 条精确关联记录</span></div>${r.evidence.length?r.evidence.map(e=>`<details class="evidence" id="evidence-${esc(e.id)}"><summary><span class="tag">${esc(e.id)}</span><b>${esc(e.service)}</b><span>${esc(e.text.match(/event=(\S+)/)?.[1]||'日志记录')}</span><span class="location">${esc(e.file)}:${e.line}</span></summary><code class="log">${esc(e.text)}</code><p class="context-label">匹配标识：${esc(e.matchedBy)} · 下方相邻行仅为上下文，可能包含其他交易</p><pre>${esc(e.context)}</pre></details>`).join(''):'<p>没有找到可用日志证据。</p>'}${r.code.text?`<details class="evidence"><summary><span class="tag">CODE</span><b>通知重试策略</b><span class="location">${esc(r.code.version)}</span></summary><p>${esc(r.code.file)}</p><pre>${esc(r.code.text)}</pre></details>`:''}<div class="section-title"><h2>运营下一步</h2><span>人工确认后执行</span></div><ol class="actions">${r.actions.map(a=>`<li>${esc(a)}</li>`).join('')}</ol><div class="uncertainty"><b>仍需确认</b><br>${r.uncertainties.map(esc).join('<br>')}</div><div class="section-title"><h2 id="ai-section-title" tabindex="-1">AI 证据分析</h2><span id="ai-result-state">${esc({disabled:'待分析',completed:r.ai.model,failed:'调用失败'}[r.ai.status])}</span></div><p>点击后将本次交易信息、问题、匹配日志和已保存的 Markdown 发送给已配置的模型。不会读取本地代码仓库。</p><button class="primary" id="analyze-ai" type="button">${r.ai.status==='completed'?'重新分析':'AI 分析'}</button><button class="text-button" id="stop-ai" type="button" hidden>停止分析</button><p id="ai-progress" role="status"></p><div id="ai-live" class="ai-live" hidden><ol id="ai-stages" class="ai-stages"></ol><div id="ai-output-sections" class="ai-output-sections"></div><div id="ai-stream-text" class="ai-text"></div></div><div id="ai-saved-text" class="ai-text">${aiTextWithReferences(r)}</div>${r.ai.status==='completed'?`<p class="ai-metadata">${esc(r.ai.model||'已配置模型')}${r.ai.analyzedAt?' · '+esc(new Date(r.ai.analyzedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})):''}${Number.isFinite(r.ai.durationMs)?' · 耗时 '+(r.ai.durationMs/1000).toFixed(1)+' 秒':''} · 引用编号可点击查看</p>`:''}${r.ai.notice?`<p>${esc(r.ai.notice)}</p>`:''}<div class="feedback-bar"><h2>处理反馈</h2><div class="feedback-options">${['已解决','需要开发介入','判断不正确'].map(s=>`<button class="text-button ${feedbackStatus===s?'selected':''}" data-feedback="${s}">${s}</button>`).join('')}</div><label>处理备注<textarea id="feedback-note" maxlength="2000" placeholder="记录最终原因或需要继续核实的情况">${esc(r.feedback?.note||'')}</textarea></label><div class="feedback-submit"><button class="primary" id="save-feedback">保存反馈</button></div></div></div><aside class="report-side"><h3>排查过程</h3><div class="steps">${r.steps.map(s=>`<div class="step"><b>${esc(s.title)}</b><p>${esc(s.detail)}</p><small>${s.count} 项结果</small></div>`).join('')}</div><div class="side-section"><h3>本次问题</h3><p>${esc(r.question||'未填写问题描述')}</p></div><div class="side-section"><h3>数据与来源</h3><p>交易与日志：沙箱数据集<br>业务规则：${esc(r.repository?r.repository+' / master@'+r.commit.slice(0,8):'v1.0')}<br>基础诊断：规则分析</p><p>当前数据用于业务验证，未连接生产交易系统。</p></div></aside></div>`;
PayTraceGraph.current=r;PayTraceGraph.bind(r,{onEvidence:openEvidence,onAnalyze:()=>{$('#ai-section-title').scrollIntoView({behavior:'smooth',block:'start'});runAi(r)}});bindInvestigation(r);$('#analyze-ai').addEventListener('click',()=>runAi(r));$('#export').addEventListener('click',exportReport);document.querySelectorAll('[data-feedback]').forEach(b=>b.addEventListener('click',()=>{feedbackStatus=b.dataset.feedback;document.querySelectorAll('[data-feedback]').forEach(x=>x.classList.toggle('selected',x===b))}));$('#save-feedback').textContent='保存并返回记录';$('#save-feedback').addEventListener('click',async()=>{
  if(!feedbackStatus)return toast('请先选择处理结果');
  const scope=workspaceId,button=$('#save-feedback'),note=$('#feedback-note').value,status=feedbackStatus;
  if(button.disabled)return;button.disabled=true;
  try{const saved=await api('/investigations/'+r.id+'/feedback','POST',{status,note},scope);
    if(scope===workspaceId&&current?.id===r.id){current=saved;if(!$('#workbench').hidden){view('history');$('#history').scrollIntoView({block:'start'})}toast('反馈已保存')}
  }catch(e){toast(e.message)}finally{button.disabled=false}
})}

function exportReport(){const r=reportForDisplay(current);const text=`# 支付交易排查单\n\n交易：${r.transaction.id}\n商户：${r.transaction.merchant}\n时间：${r.createdAt}\n问题：${r.question}\n诊断方式：${r.mode}${investigationMarkdown(r)}\n\n## ${r.title}\n${r.summary}\n\n## 证据\n${r.evidence.map(e=>`- [${e.id}] ${e.service} ${e.file}:${e.line}\n  ${e.text}`).join('\n')}\n\n## 操作建议\n${r.actions.map((a,i)=>`${i+1}. ${a}`).join('\n')}\n\n## 待确认\n${r.uncertainties.join('\n')}\n\n## AI 补充分析（需人工复核）\n${r.ai.text}\n\n## 处理反馈\n${r.feedback?.status||'未反馈'}\n${r.feedback?.note||''}\n`;const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=r.transaction.id+'-排查单.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function loadHistory(){
  const scope=workspaceId;
  try{const rows=await api('/investigations','GET',undefined,scope);if(scope!==workspaceId)return;historyRows=rows;renderHistory()}
  catch(e){toast(e.message)}
}
function resetHistoryFilters(){
  historyPage=1;historySelection.clear();
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
  const pages=Math.max(1,Math.ceil(rows.length/historyPageSize));historyPage=Math.min(historyPage,pages);
  const pageRows=rows.slice((historyPage-1)*historyPageSize,historyPage*historyPageSize);
  const visibleIds=new Set(pageRows.map(r=>r.id));historySelection=new Set([...historySelection].filter(id=>visibleIds.has(id)));
  $('#history-page-label').textContent='第 '+historyPage+' / '+pages+' 页';
  $('#history-prev').disabled=historyDeleting||historyPage<=1;$('#history-next').disabled=historyDeleting||historyPage>=pages;
  $('#history-count').textContent=activeWorkspace.name+' · 筛选结果 '+rows.length+' / '+historyRows.length+' 条，本页 '+pageRows.length+' 条';
  $('#history-list').innerHTML=rows.length?`<div class="table-scroll"><table class="history-table"><thead><tr><th><input type="checkbox" id="history-select-all" aria-label="全选当前页"></th><th>交易流水号 / 商户</th><th>排查结论</th><th>创建时间</th><th>处理状态</th><th>AI 分析</th><th></th></tr></thead><tbody>${pageRows.map(r=>`<tr data-report="${esc(r.id)}" tabindex="0"><td><input type="checkbox" data-select-report="${esc(r.id)}" aria-label="选择 ${esc(r.transaction.id)}" ${historySelection.has(r.id)?'checked':''}></td><td>${esc(r.transaction.id)}<small class="history-merchant">${esc(r.transaction.merchant)}</small></td><td>${esc(r.title)}</td><td>${esc(new Date(r.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</td><td><span class="tag ${r.feedback?.status==='已解决'?'':'amber'}">${esc(r.feedback?.status||'待反馈')}</span></td><td>${r.ai?.status==='completed'?'已分析':'未分析'}</td><td><button type="button" class="text-button danger-action" data-delete-report="${esc(r.id)}">删除</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-history">${historyRows.length?'没有符合筛选条件的记录，请调整搜索条件。':'当前工作空间还没有排查记录。'}</div>`;
  syncHistorySelection();
  document.querySelectorAll('[data-report]').forEach(el=>{
    const open=()=>{current=rows.find(r=>r.id===el.dataset.report);view('workbench');renderReport();$('#question').value=[current.searchQuery,current.question].filter(Boolean).join('：');window.questionImages?.set(current.images)};
    el.addEventListener('click',e=>{if(!e.target.closest('[data-delete-report], [data-select-report]'))open()});el.addEventListener('keydown',e=>{if(e.target===el&&e.key==='Enter')open()});
  });
}
function syncHistorySelection(){
  const checkboxes=[...document.querySelectorAll('[data-select-report]')],all=$('#history-select-all');
  if(all){all.checked=checkboxes.length>0&&historySelection.size===checkboxes.length;all.indeterminate=historySelection.size>0&&!all.checked;all.disabled=historyDeleting}
  checkboxes.forEach(el=>el.disabled=historyDeleting);
  $('#history-selected-count').textContent='已选 '+historySelection.size+' 条（当前页）';
  $('#history-delete-selected').disabled=historyDeleting||!historySelection.size;
}
async function deleteHistory(ids){
  if(historyDeleting||!ids.length)return;
  const scope=workspaceId;
  if(!confirm('删除选中的 '+ids.length+' 条排查记录及其反馈、补证和 AI 分析？此操作无法撤销。'))return;
  historyDeleting=true;renderHistory();
  try{if(ids.includes(current?.id))aiJob?.controller.abort();await api('/investigations','DELETE',{ids},scope);
    if(scope===workspaceId){if(ids.includes(current?.id)){current=null;$('#result').replaceChildren();$('#result').hidden=true;$('#empty').hidden=false}historySelection.clear();await loadHistory();toast('已删除 '+ids.length+' 条排查记录')}
  }catch(error){toast(error.message)}finally{historyDeleting=false;renderHistory()}
}
$('#history-list').addEventListener('click',e=>{const b=e.target.closest('[data-delete-report]');if(b)deleteHistory([b.dataset.deleteReport])});
$('#history-list').addEventListener('change',e=>{
  if(historyDeleting)return;
  if(e.target.id==='history-select-all'){
    historySelection.clear();document.querySelectorAll('[data-select-report]').forEach(el=>{el.checked=e.target.checked;if(el.checked)historySelection.add(el.dataset.selectReport)});
  }else if(e.target.matches('[data-select-report]')){const id=e.target.dataset.selectReport;e.target.checked?historySelection.add(id):historySelection.delete(id)}
  syncHistorySelection();
});
$('#history-delete-selected').onclick=()=>deleteHistory([...historySelection]);
function historyFilterChanged(){historyPage=1;historySelection.clear();renderHistory()}
$('#history-search').addEventListener('input',historyFilterChanged);
$('#history-feedback').addEventListener('change',historyFilterChanged);
$('#history-ai').addEventListener('change',historyFilterChanged);
$('#history-reset').addEventListener('click',()=>{resetHistoryFilters();renderHistory()});
$('#history-page-size').onchange=e=>{historyPageSize=Number(e.target.value);historyFilterChanged()};
$('#history-prev').onclick=()=>{if(historyPage>1){historyPage--;historySelection.clear();renderHistory()}};
$('#history-next').onclick=()=>{historyPage++;historySelection.clear();renderHistory()};
function drawFlow(){const canvas=$('#flow-canvas');if(!canvas||$('#empty').hidden||$('#workbench').hidden)return;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);const labels=selectedCase?.pipeline?.map(p=>p.label)||activeWorkspace.flow||activeWorkspace.cases[0]?.pipeline.map(p=>p.label)||[];if(labels.length<2)return;const gap=(w-48)/(labels.length-1),y=h/2-8;c.strokeStyle='#cddfdb';c.lineWidth=1;c.beginPath();c.moveTo(24,y);c.lineTo(w-24,y);c.stroke();labels.forEach((label,i)=>{const x=24+gap*i;c.fillStyle=i===3?'#e8bb66':'#148875';c.beginPath();c.arc(x,y,6,0,Math.PI*2);c.fill();c.fillStyle='#f7f9fa';c.beginPath();c.arc(x,y,2,0,Math.PI*2);c.fill();c.fillStyle='#627b7d';c.font='11px -apple-system, sans-serif';c.textAlign=i===0?'left':i===labels.length-1?'right':'center';c.fillText(label,x,y+29);if(i<labels.length-1){c.fillStyle='#9abcb3';c.textAlign='center';c.fillText('›',x+gap/2,y+4)}})}
window.addEventListener('resize',drawFlow);init();

function syncKnowledgeMode(){
  const enabled=$('#scan-enabled').checked;
  $('#repository-config').hidden=!enabled;
  $('#knowledge-mode').textContent=enabled?'旧路径配置已选择代码扫描；导入到上方项目卡片后，点击 AI 分析并保存。':'仅使用 Markdown 文档：不触发代码扫描。';
  document.querySelectorAll('#project-list input').forEach(input=>input.disabled=!enabled);
}
function addProjectRow(project={name:'',path:'',branch:'master'}){
  const row=document.createElement('div');row.className='project-row';
  row.innerHTML=`<label>项目名称<input data-field="name" required maxlength="100" placeholder="例如：外卡 trx" value="${esc(project.name)}"></label><label>本地仓库路径<input data-field="path" required maxlength="1000" placeholder="/path/to/project" value="${esc(project.path)}"></label><label>扫描分支<input data-field="branch" maxlength="200" placeholder="master" value="${esc(project.branch)}"></label><button type="button" class="text-button remove-project">移除</button>`;
  row.querySelector('button').addEventListener('click',()=>row.remove());$('#project-list').append(row);syncKnowledgeMode();
}
function showKnowledgeSaved(k){$('#knowledge-saved').textContent=k.usingDefault?'已载入默认业务文档 · 点击保存后存入本地':k.updatedAt?'已保存到本地 · '+new Date(k.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):(k.markdown?'已载入业务文档 · 修改后请保存':'尚未保存文档')}
function markKnowledgeDirty(){$('#knowledge-saved').textContent='有未保存的修改，请点击「保存知识配置」'}
async function loadKnowledge(){try{const scope=workspaceId,k=await api('/knowledge');if(scope!==workspaceId)return;$('#scan-enabled').checked=k.scanEnabled;$('#knowledge-markdown').value=k.markdown;$('#project-list').replaceChildren();k.projects.forEach(addProjectRow);syncKnowledgeMode();showKnowledgeSaved(k)}catch(e){toast(e.message)}}
$('#knowledge-form').addEventListener('input',markKnowledgeDirty);
$('#knowledge-form').addEventListener('click',e=>{if(e.target.closest('#add-project, .remove-project'))markKnowledgeDirty()});
$('#clear-markdown').addEventListener('click',()=>{if(confirm('清空当前编辑器中的业务文档？点击保存知识配置后生效。')){$('#knowledge-markdown').value='';markKnowledgeDirty()}});
$('#download-markdown').addEventListener('click',()=>{const text=$('#knowledge-markdown').value;if(!text.trim())return toast('请先填写或导入 Markdown 文档');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='PayTrace-业务知识.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('#scan-enabled').addEventListener('change',syncKnowledgeMode);
$('#add-project').addEventListener('click',()=>addProjectRow());
$('#markdown-file').addEventListener('change',async e=>{
  const scope=workspaceId,file=e.target.files[0];if(!file)return;
  try{if(!/\.(md|markdown)$/i.test(file.name))throw Error('请选择 Markdown 文件');if(file.size>400000)throw Error('文档过大，请选择 400 KB 以内的文件');const text=await file.text();if(text.length>100000)throw Error('文档请控制在 10 万字以内');if(scope!==workspaceId)return;$('#knowledge-markdown').value=text;markKnowledgeDirty();toast('文档已导入，请保存知识配置')}catch(error){toast(error.message)}finally{e.target.value=''}
});
$('#knowledge-form').addEventListener('submit',async e=>{
  e.preventDefault();const projects=[...document.querySelectorAll('.project-row')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value]))).filter(p=>p.name.trim()||p.path.trim());
  try{const k=await api('/knowledge','PUT',{scanEnabled:$('#scan-enabled').checked,projects,markdown:$('#knowledge-markdown').value});showKnowledgeSaved(k);toast(window.storageDriver==='mysql'?'文档与配置已保存到数据库':'文档与配置已保存到当前浏览器')}catch(error){toast(error.message)}
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
  // The server enforces the selected provider’s saved deadline for every analysis.
  const signal=job.controller.signal;
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
    const message=job.controller.signal.aborted?'分析已停止':error.message;
    stage('failed',message+' · 本次未保存，原有报告保留');
    live.classList.add('is-incomplete');
    if(live.isConnected){$('#ai-saved-text').hidden=false;$('#ai-result-state').textContent=report.ai.status==='completed'?report.ai.model+' · 本次未完成':'未完成';}
    if(!job.controller.signal.aborted)toast('AI 分析未完成，原有报告已保留');
  }finally{
    if(aiJob===job)aiJob=null;
    button.disabled=false;if(graphButton)graphButton.disabled=false;stop.hidden=true;
  }
}

let loadedModel=null,modelStore={activeId:null,providers:[]},modelBusy=false,modelLoadVersion=0;
async function modelRequest(endpoint,method='GET',body){
  if(location.protocol==='file:')throw Error('请运行 npm start，并通过 http://127.0.0.1:5173 配置模型');
  const testSeconds=body?.savedOnly?(modelStore.providers.find(p=>p.id===body.id)?.timeoutSeconds??300):(body?.timeoutSeconds??300);
  const timeoutMs=endpoint==='test'?Number(testSeconds)*1000+5000:65000;
  const response=await fetch('/api/ai/'+endpoint,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
  let data;try{data=await response.json()}catch{throw Error('本地模型服务不可用，请重启 npm start')}
  if(!response.ok)throw Error(data.message||'模型配置请求失败');return data;
}
function renderProviders(){
  $('#provider-storage-note').textContent=window.storageDriver==='mysql'?'API Key 已保存时会加密存储在数据库，后续自动复用，无需重复填写；编辑时留空保留。':'API Key 保存到服务端本机文件，后续自动复用，无需重复填写；编辑时留空保留。';
  $('#provider-list').innerHTML=modelStore.providers.length?modelStore.providers.map(p=>{
    const active=p.id===modelStore.activeId;
    return `<article class="provider-card ${active?'is-active':''}"><div class="provider-card-top"><div class="provider-icon" aria-hidden="true">${p.provider==='ollama'?'L':'AI'}</div><div class="provider-title"><h3>${esc(p.name)}</h3><span>${p.provider==='ollama'?'Ollama · 本地模型':'Chat Completions · 兼容接口'}</span></div><span class="provider-badge ${active?'active-badge':''}">${active?(p.enabled?'● 当前使用':'当前服务 · 待完善'):'备用'}</span></div><div class="provider-detail"><strong>${esc(p.model)}</strong><span>分析超时：${esc(p.timeoutSeconds??300)} 秒</span><span title="${esc(p.base)}">${esc(p.base)}</span></div><div class="provider-card-bottom"><span class="provider-key">${p.provider==='ollama'?'本地连接 · 无需密钥':p.hasKey?(window.storageDriver==='mysql'?'密钥已加密保存 · 自动复用':'密钥已保存 · 自动复用'):'待配置密钥'}</span><div class="provider-buttons"><button type="button" class="text-button" data-model-action="test" data-model-id="${esc(p.id)}" ${!p.enabled?'disabled':''}>测试</button><button type="button" class="text-button" data-model-action="edit" data-model-id="${esc(p.id)}">编辑</button><button type="button" class="text-button delete-model" data-model-action="delete" data-model-id="${esc(p.id)}">删除</button><button type="button" class="${active?'provider-current':'primary'}" data-model-action="activate" data-model-id="${esc(p.id)}" ${active||!p.enabled?'disabled':''}>${active?'已选用':'启用'}</button></div></div></article>`;
  }).join(''):'<div class="provider-empty"><h3>添加第一个模型服务</h3><p>接入云端兼容接口或本地 Ollama，开始使用 AI 辅助排查。</p><button class="text-button" type="button" data-model-action="add">＋ 添加服务商</button></div>';
}
function modelControls(busy){
  if(busy)++modelLoadVersion;modelBusy=busy;
  $('#model-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=busy);
  $('#close-model').disabled=busy;$('#add-model').disabled=busy;
  if(busy)$('#provider-list').querySelectorAll('button').forEach(el=>el.disabled=true);else renderProviders();
}
function refreshModelStatus(){
  const active=modelStore.providers.find(p=>p.id===modelStore.activeId);
  $('#model-label').textContent=active?.enabled?'AI 已配置 · '+active.model:'AI 待配置';
  $('#model-status').textContent=active?active.name+' / '+active.model+(active.enabled?' · 已配置，连接以测试结果为准':' · 请完善配置'):'尚未启用模型服务';
}
function syncModelForm(){
  const ollama=$('#ai-provider').value==='ollama';
  $('#ai-key-label').hidden=ollama;$('#ai-clear-label').hidden=ollama||!loadedModel?.hasKey;
  $('#ai-address-help').textContent=ollama?'默认地址 http://127.0.0.1:11434，需提前运行 Ollama 并安装模型。':'在根地址后追加 /chat/completions；如需 /v1，请包含在地址中。';
  const same=loadedModel&&loadedModel.provider===$('#ai-provider').value&&loadedModel.base===$('#ai-base').value.trim().replace(/\/+$/,'');
  $('#ai-key-state').textContent=ollama?'本地 Ollama 无需 API Key。':same&&loadedModel.hasKey?'已保存 API Key，后续自动复用，无需再次填写。此处不回显，留空保留，输入新值可替换。':'请输入 API Key，更换地址后需重新填写。';
}
async function loadModelConfig(){
  if(modelBusy||window.workspaceMutation)return;
  const version=++modelLoadVersion;$('#provider-list').replaceChildren();
  $('#add-model').disabled=true;$('#provider-feedback').textContent='正在读取已保存配置…';
  try{const store=await modelRequest('providers');if(version!==modelLoadVersion||modelBusy)return;modelStore=store;renderProviders();refreshModelStatus();$('#add-model').disabled=false;$('#provider-feedback').textContent=''}
  catch(e){if(version!==modelLoadVersion||modelBusy)return;$('#provider-list').innerHTML='';$('#provider-feedback').textContent=e.message}
}
function openModel(id){
  if(modelBusy||window.workspaceMutation)return;
  loadedModel=modelStore.providers.find(p=>p.id===id)||null;
  $('#model-form').reset();$('#model-dialog-title').textContent=loadedModel?'编辑服务商':'添加服务商';
  $('#model-presets').hidden=!!loadedModel;
  $('#ai-name').value=loadedModel?.name||'';$('#ai-provider').value=loadedModel?.provider||'compatible';
  $('#ai-timeout').value=loadedModel?.timeoutSeconds??300;
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
  const body={action:'save',id:loadedModel?.id,name:$('#ai-name').value,provider:$('#ai-provider').value,base:$('#ai-base').value,model:$('#ai-model').value,timeoutSeconds:Number($('#ai-timeout').value),key:$('#ai-key').value,clearKey:$('#ai-clear').checked,activate:$('#ai-activate').checked};
  modelControls(true);$('#model-feedback').textContent=test?'正在测试连接，最长等待约 '+body.timeoutSeconds+' 秒…':'正在保存服务商配置…';
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
  if(!entry)return;
  if(action==='delete'&&!confirm('删除服务商“'+entry.name+'”及其已保存密钥？'+(id===modelStore.activeId?'删除当前服务后，AI 将处于未启用状态，需手动启用其他服务。':'')))return;
  modelControls(true);$('#provider-feedback').textContent=action==='test'?'正在测试“'+entry.name+'”，最长等待约 '+(entry.timeoutSeconds??300)+' 秒…':'正在更新配置…';
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
  return `<section class="investigation-panel" aria-label="支付状态分歧地图"><div class="section-title"><h2>支付状态分歧地图</h2><span>三个视角 · 同一笔交易</span></div><div class="party-grid">${m.parties.map((p,i)=>`<article class="party ${i===2?'merchant-party':''}"><small>0${i+1} / ${esc(p.name)}</small><h3>${esc(p.state)}</h3><p>${esc(p.detail)}</p>${refs(p.refs)}</article>`).join('')}</div><p class="map-caption">${r.supplement?(r.supplement.outcome==='completed'?'订单完成状态已对齐；通知确认问题仍未闭环。':'已观察到平台与商户状态分歧；具体原因仍待取证。'):'先区分各方事实，再核实未知状态；缺失证据不等于业务失败。'}</p><details class="event-timeline"><summary>展开交易时间线 · ${r.evidence.length} 条证据</summary><ol>${r.evidence.map(e=>`<li><time>${esc(e.text.split(' ')[0])}</time><span>${esc(e.service)} / ${esc(e.text.match(/event=(\S+)/)?.[1]||'记录')}</span>${refs([e.id])}</li>`).join('')}</ol></details><div class="next-evidence"><span class="tag">下一步取证 · 规则推荐</span><h3>${esc(m.next)}</h3><p>${r.supplement?'商户查单已补齐，继续核查剩余证据缺口；当前结果仍不能单独确定根因。':m.canSupplement?'这一步可以区分“商户未完成订单”和“已完成但通知未确认”，比继续重复查支付结果更有助于缩小范围。':'取得对应系统的新证据后再确认原因；当前案例仅展示取证建议。'}</p>${m.canSupplement?`<ul class="hypotheses">${m.hypotheses.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>${r.supplement?`<p class="supplement-receipt">已加入 [${esc(r.supplement.id)}] · ${esc(r.supplement.source)}<br>补入时间：${esc(new Date(r.supplement.addedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}。重新发起排查可核实其他状态。</p>`:`<fieldset class="supplement-options"><legend>选择商户查单结果（沙箱预设）</legend><label><input type="radio" name="merchant-outcome" value="completed" checked>商户订单已完成</label><label><input type="radio" name="merchant-outcome" value="pending">商户订单仍待支付</label></fieldset><button type="button" class="primary" id="add-supplement">补充证据并更新结论 ↗</button><p id="supplement-progress" role="status"></p>`}`:''}</div>${r.original?`<div class="conclusion-change" tabindex="-1" id="conclusion-change"><h3>新增证据如何改变结论</h3><div><article><small>补证前</small><b>${esc(r.original.title)}</b><p>${esc(r.original.summary)}</p></article><article><small>补证后 · [${esc(r.supplement.id)}]</small><b>${esc(r.title)}</b><p>${esc(r.summary)}</p></article></div><details><summary>查看补证前的处理建议与待确认事项</summary><ul>${[...r.original.actions,...r.original.uncertainties].map(a=>`<li>${esc(a)}</li>`).join('')}</ul></details></div>`:''}</section>`;
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
  $('#workspace-repository').textContent=w.custom?'自定义工作空间':w.repository||'支付业务';
  $('#settings-workspace').textContent=w.name+' / 服务管理';
  $('#flow-note').textContent=w.custom?'等待接入业务链路':w.repository?'业务步骤依据代码整理；cb_common 为共享模块，不是独立服务。':'同步受理与异步通知分别核实';
  $('#workspace-overview').innerHTML=`<div class="workspace-summary"><div><h2>${esc(w.name)}</h2><p>${esc(w.description)}</p></div><span class="tag">${w.businesses.length} 条业务线</span></div><div class="business-chips">${w.businesses.map(b=>`<span>${esc(b)}</span>`).join('')}</div>${w.repository?`<details class="workspace-origin"><summary>代码依据：${esc(w.repository)} · master · ${esc(w.commit.slice(0,8))}</summary><p>业务入口、分支与任务关系来自本次静态代码审阅。交易、金额及日志为沙箱预设，不代表真实执行记录。点击业务案例查看对应链路与来源文件。</p></details>`:w.custom?'<p class="workspace-origin">独立业务空间 · 配置项目并运行 AI 分析后，在此展示业务链路。</p>':'<p class="workspace-origin">渠道支付、平台交易与商户订单分别核实。</p>'}<div id="project-overview-results"></div>`;window.loadProjectOverview?.();
}
function businessPipelinePanel(r){
  return `<section class="business-pipeline"><div class="section-title"><h2>${esc(r.transaction.business)} · 业务链路</h2><span>${esc(r.workspaceName)}</span></div><ol class="pipeline-nodes">${r.pipeline.map((p,i)=>`<li><span class="pipeline-number">${String(i+1).padStart(2,'0')}</span><h3>${esc(p.label)}</h3><p>${esc(p.service)}</p><small>${esc(p.detail)}</small></li>`).join('')}</ol><p>以上为代码中的业务路径，不表示每一步已执行。下方日志证据记录当前案例的已知进展。</p><div class="service-coverage">${[...new Set(r.pipeline.map(p=>p.service))].map(service=>{const evidence=r.evidence.filter(e=>e.service===service);return `<div><b>${esc(service)}</b><span>${evidence.length?'已关联 '+evidence.length+' 条记录':'当前无日志证据'}</span>${evidence.map(e=>`<button type="button" class="evidence-link" data-evidence="${esc(e.id)}">[${esc(e.id)}] ${esc(e.text.match(/event=(\S+)/)?.[1]||'记录')}</button>`).join('')}</div>`}).join('')}</div><details class="source-references"><summary>查看代码来源 · ${r.sources.length} 处依据</summary><p>${esc(r.repository)} / master / ${esc(r.commit)}<br>共享模块 cb_common 的调用发生在宿主服务内；消息与回调是异步路径。</p>${r.sources.map(s=>`<article><b>${esc(s.symbol)}</b><code>${esc(s.file)}:${s.line}</code><p>${esc(s.note)}</p></article>`).join('')}</details></section>`;
}

function aiTextWithReferences(r){
  const ids=new Set(r.evidence.map(e=>e.id));
  return esc(r.ai.text).replace(/\[(E\d+)\]/g,(match,id)=>ids.has(id)?`<button type="button" class="evidence-link ai-citation" data-evidence="${id}" aria-label="查看证据 ${id}">${match}</button>`:match).replace(/^#{1,3}[ \t]+(已确认事实|可能原因|待核实事项|运营下一步)[ \t]*$/gm,'<h4>$1</h4>');
}

function renderScreenshotReport(report,container){
  const images=PayTraceImages.validate(report.images);if(!images.length)return;
  const section=document.createElement('section');section.className='report-screenshots';
  const title=document.createElement('h3');title.textContent='本次截图（点击放大）';section.append(title);
  const grid=document.createElement('div');grid.className='screenshot-previews';section.append(grid);
  images.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.className='screenshot-card text-button';const img=document.createElement('img');img.src=item.dataUrl;img.alt='图'+(index+1)+'：'+item.name;button.append(img,document.createTextNode('图'+(index+1)));button.onclick=()=>{const dialog=document.createElement('dialog');dialog.style.maxWidth='95vw';const close=document.createElement('button');close.textContent='关闭';close.className='text-button';close.onclick=()=>dialog.close();const full=new Image();full.src=item.dataUrl;full.alt=img.alt;full.style.cssText='display:block;max-width:85vw;max-height:80vh;object-fit:contain';dialog.append(close,full);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal()};grid.append(button)});
  if(container)container.append(section);else document.querySelector('#result .result-heading').after(section);
}
function screenshotMarkdown(report){return (report.images||[]).length?'\n\n## 问题截图\n'+PayTraceImages.validate(report.images).map((item,index)=>`![图${index+1}](${item.dataUrl})`).join('\n\n'):''}
