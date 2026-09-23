function followupLogText(t){
  if(!t.logQuery)return '';
  return '\n\n补查日志（'+t.logQuery.checkedAt+'）\n'+t.logQuery.coverage.map(c=>JSON.stringify(c)).join('\n')+'\n'+t.logQuery.evidence.map(e=>'['+e.id+'] '+e.source+' / '+e.environment+' '+e.file+':'+e.line+'\n'+e.text+'\n'+(e.context||'')).join('\n\n');
}
let followupJob=null;
const pendingFollowups=new Map();
window.addEventListener('paytrace:logout',()=>followupJob?.abort());

function followupMarkdown(r){
  const turns=[...(r.followups||[])];const pending=pendingFollowups.get(r.id);if(pending)turns.push({...pending.turn,unsaved:true});
  return turns.length?'\n\n## 追问对话\n'+turns.map((t,i)=>`\n### 第 ${i+1} 轮${t.unsaved?'（未保存）':''}\n\n问：${t.question}${screenshotMarkdown(t)}\n\n答：${t.text}${followupLogText(t)}\n\n模型：${t.model} · ${t.createdAt}`).join('\n'):'';
}
function refreshFollowupReport(report){
  const note=$('#real-note')?.value,status=$('#real-feedback')?.value;
  current=report;renderReport();
  if(note!==undefined)$('#real-note').value=note;
  if(status!==undefined)$('#real-feedback').value=status;
}
function renderFollowup(r){
  const pending=pendingFollowups.get(r.id),history=PayTraceFollowup.context(r);
  const section=document.createElement('section');section.className='followup-panel';section.id='followup-panel';
  section.innerHTML=`<div class="section-title"><h2>继续追问</h2><span>围绕本次交易继续排查</span></div><p>可粘贴或添加新截图，结合本次日志、原始截图、当前已保存的业务文档和最近对话回答。追问“查附近日志”或“扩大范围”会重新读取当前空间的日志源，并保留补查证据。${history.omitted?'较早的 '+history.omitted+' 轮对话仍保留在报告中，本次未加入模型上下文。':''}</p><div id="followup-history">${(r.followups||[]).map(t=>followupTurnHtml(t)).join('')}${pending?followupTurnHtml(pending.turn,true):''}</div><form id="followup-form"><label for="followup-question">继续问 AI</label><div class="question-composer" id="followup-composer"><div id="followup-image-previews" class="screenshot-previews"></div><textarea id="followup-question" rows="3" maxlength="4000" required aria-describedby="followup-upload-hint" placeholder="继续描述问题，或粘贴截图…例如：哪条日志能证明这个原因？" ${pending?'disabled':''}></textarea><div class="composer-toolbar"><div class="composer-attachments"><button id="add-followup-images" class="attachment-button" type="button" aria-label="添加追问截图" title="添加截图（最多 10 张）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button><input id="followup-images" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><span id="followup-upload-hint">添加、粘贴或拖入截图 · 最多 10 张</span></div><div class="model-actions"><button class="primary" id="followup-send" type="submit" ${pending?'disabled':''}>发送追问</button><button class="text-button" id="followup-stop" type="button" hidden>停止回答</button><button class="text-button" id="followup-save" type="button" ${pending?'':'hidden'}>重试保存</button></div></div></div><p id="followup-image-status" role="status" aria-live="polite"></p><p id="followup-status" role="status">${pending?'回答尚未保存，请重试保存或先导出报告。':''}</p><div id="followup-live" class="ai-text" aria-live="polite" hidden></div></form>`;
  $('#result .ai-text').after(section);
  const attachments=window.createImageUpload({picker:$('#followup-images'),previews:$('#followup-image-previews'),status:$('#followup-image-status'),composer:$('#followup-composer'),addButton:$('#add-followup-images'),question:$('#followup-question'),form:$('#followup-form'),submit:$('#followup-send')});
  section.querySelectorAll('[data-followup-images]').forEach((container,index)=>{const turn=[...(r.followups||[]),...(pending?[pending.turn]:[])][index];renderScreenshotReport(turn,container)});
  $('#followup-stop').onclick=()=>followupJob?.abort();
  $('#followup-save').onclick=async()=>{
    const button=$('#followup-save');button.disabled=true;
    try{const saved=await api('/investigations/'+r.id+'/followups','POST',pendingFollowups.get(r.id),r.workspaceId);pendingFollowups.delete(r.id);if(current?.id===r.id){refreshFollowupReport(saved)}toast('追问已保存')}
    catch(e){$('#followup-status').textContent=e.message+'。回答仍可导出。'}finally{button.disabled=false}
  };
  $('#followup-form').onsubmit=e=>{e.preventDefault();runFollowup(r,attachments)};
}
function followupTurnHtml(t,unsaved=false){return `<article class="followup-turn"><p class="followup-question"><b>你：</b>${esc(t.question)}</p><div data-followup-images></div><div class="ai-text"><b>AI：</b>${esc(t.text)}</div>${t.logQuery?'<details><summary>查看本轮补查日志与覆盖</summary><pre>'+esc(followupLogText(t))+'</pre></details>':''}<small>${esc(t.model)} · ${esc(new Date(t.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}${unsaved?' · 未保存':''}</small></article>`;}
async function runFollowup(r,attachments){
  if(busy||followupJob||pendingFollowups.has(r.id))return;
  let images;try{images=attachments.get()}catch(e){$('#followup-status').textContent=e.message;return;}
  const question=$('#followup-question').value.trim();if(!question&&!images.length)return;
  const controller=new AbortController(),scope=r.workspaceId,status=$('#followup-status'),live=$('#followup-live'),input=$('#followup-question');
  followupJob=controller;busy=true;input.disabled=true;$('#followup-send').disabled=true;$('#followup-stop').hidden=false;$('#real-save').disabled=true;
  status.textContent='正在准备追问…';live.textContent='';live.hidden=false;
  const expectedCount=(r.followups||[]).length,revision=r.revision??0;
  try{
    const knowledge=await api('/knowledge','GET',undefined,scope);controller.signal.throwIfAborted();
    const history=PayTraceFollowup.context(r);
    const report={id:r.id,kind:r.kind,workspaceId:scope,transaction:r.transaction,question:r.question,images:r.images,evidence:r.evidence,coverage:r.coverage,ai:r.ai,followups:history.turns,latestLogQuery:history.latestLogQuery};
    const response=await fetch('/api/investigations/followup/stream',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({workspace:scope,reportId:r.id,report,question,images,markdown:knowledge.markdown||'',expectedCount,revision})});
    if(!response.ok){const error=await response.json();throw Error(error.message||'追问请求失败');}
    let result;
    await PayTraceStream.readEvents(response,'sse',({event,data})=>{
      const value=JSON.parse(data);
      if(event==='error')throw Error(value.message);
      if(event==='stage')status.textContent=value.message;
      if(event==='delta'){live.textContent+=value.text;status.textContent='AI 正在回答…';}
      if(event==='done'){result=value;return false;}
    });
    if(!result?.turn)throw Error('追问连接中断，请重试');
    if(images.length)result.turn.images=images;
    const update={turn:result.turn,expectedCount,revision};pendingFollowups.set(r.id,update);
    let saved;
    if(result.saved){saved=PayTraceFollowup.append(r,update);pendingFollowups.delete(r.id);}
    else if(!result.saveError){try{saved=await api('/investigations/'+r.id+'/followups','POST',update,scope);pendingFollowups.delete(r.id)}catch(e){result.saveError=e.message}}
    if(current?.id===r.id&&workspaceId===scope){refreshFollowupReport(saved||r);if(result.saveError)$('#followup-status').textContent='回答已完成，但保存失败：'+result.saveError+'。可重试保存或导出报告。';else $('#followup-question').focus();}
  }catch(e){
    status.textContent=(controller.signal.aborted?'已停止回答':e.message)+'；问题和截图已保留，可再次发送。';
    if(live.textContent)status.textContent+=' 下方为未完成内容，未保存。';
  }finally{
    if(followupJob===controller)followupJob=null;busy=false;
    if(current?.id===r.id&&workspaceId===scope){const pending=pendingFollowups.has(r.id);$('#followup-question').disabled=pending;$('#followup-send').disabled=pending;$('#followup-stop').hidden=true;$('#real-save').disabled=false;}
  }
}
