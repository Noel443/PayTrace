const PayTraceResolution = (() => {
  const choices = [
    {status:'已解决', label:'已解决', icon:'✓', summary:'已确认原因并完成处理', title:'解决情况', hint:'说明最终原因、实际处理动作和验证结果，方便下次参考。', outline:'最终原因：\n处理动作：\n验证结果：'},
    {status:'需要开发介入', label:'需要研发介入', icon:'↗', summary:'需要进一步排查或修复', title:'研发接手信息', hint:'说明异常表现、相关证据和希望研发协助确认的事项。', outline:'异常表现与影响范围：\n已排查事项与证据编号：\n需要研发确认或处理：'},
    {status:'判断不正确', label:'判断不正确', icon:'!', summary:'已有证据与分析结论不符', title:'判断修正说明', hint:'指出哪项判断有误，补充反证；尚未确认的原因可标注待核实。', outline:'不正确的判断：\n反证与证据编号：\n修正结论或待核实事项：'}
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(report) {
    return `<section class="feedback-bar resolution-panel" aria-labelledby="resolution-title">
      <div class="resolution-heading"><div><h2 id="resolution-title">处理结论</h2><p>记录人工确认的结果，帮助后续跟进与复盘。</p></div><span class="tag">人工反馈</span></div>
      <div class="resolution-options" role="group" aria-label="选择处理结果">${choices.map(c=>`<button type="button" class="resolution-option" data-resolution="${c.status}" aria-pressed="false"><span class="resolution-icon" aria-hidden="true">${c.icon}</span><span><strong>${c.label}</strong><small>${c.summary}</small></span><span class="resolution-check" aria-hidden="true">✓</span></button>`).join('')}</div>
      <div class="resolution-note-heading"><label id="resolution-note-label" for="real-note">处理备注（选填）</label><button type="button" class="resolution-link" id="resolution-outline">插入填写提纲</button></div>
      <textarea id="real-note" maxlength="2000" aria-describedby="resolution-hint resolution-count">${escape(report.feedback?.note||'')}</textarea>
      <div class="resolution-note-meta"><span id="resolution-hint"></span><span id="resolution-count"></span></div>
      <div class="resolution-footer"><span id="resolution-save-state" role="status" aria-live="polite"></span><div class="resolution-buttons"><button type="button" class="primary" id="real-save">保存反馈</button></div></div>
      <div class="resolution-retry"><div><strong>需要获取最新日志？</strong><p>重新查询并分析会生成新报告，当前报告及已保存的反馈会保留。未保存的反馈请先保存。</p></div><button type="button" class="text-button" id="real-retry">重新查询并分析</button></div>
    </section>`;
  }
  function bind(panel, report, {save, onSaved, retry, isBusy=()=>false}) {
    const find = selector => panel.querySelector(selector);
    const note=find('#real-note'), button=find('#real-save'), state=find('#resolution-save-state');
    const cards=panel.querySelectorAll('[data-resolution]');
    let saved={status:report.feedback?.status||'',note:report.feedback?.note||''};
    let status=saved.status, saving=false, error='';
    const dirty=()=>status!==saved.status||note.value!==saved.note;
    function update() {
      const choice=choices.find(c=>c.status===status);
      cards.forEach(card=>{card.setAttribute('aria-pressed',String(card.dataset.resolution===status));card.disabled=saving;});
      note.disabled=saving;
      find('#resolution-note-label').textContent=(choice?.title||'处理备注')+'（选填）';
      find('#resolution-hint').textContent=choice?.hint||'先选择处理结果，再补充说明；切换结果会保留已填写的内容。';
      note.placeholder=choice?.outline||'选择处理结果后，可插入对应的填写提纲';
      find('#resolution-count').textContent=note.value.length+' / 2000';
      find('#resolution-outline').disabled=!choice||saving;
      button.disabled=saving||!choice||(!dirty()&&Boolean(saved.status));
      button.textContent=saving?'保存中…':'保存反馈';
      find('#real-retry').disabled=saving;
      state.textContent=error||(saving?'正在保存反馈…':dirty()?'未保存 · 当前修改尚未保存':saved.status?'已保存 · 反馈已记录':'未保存 · 请选择处理结果');
    }
    cards.forEach(card=>card.onclick=()=>{status=card.dataset.resolution;error='';update();});
    note.oninput=()=>{error='';update();};
    find('#resolution-outline').onclick=()=>{
      const choice=choices.find(c=>c.status===status);if(!choice||saving)return;
      const next=note.value+(note.value?'\n\n':'')+choice.outline;
      if(next.length>2000){error='未保存 · 插入提纲会超过 2000 字，请先精简备注。';update();return;}
      note.value=next;error='';update();note.focus();
    };
    button.onclick=async()=>{
      if(saving||!choices.some(c=>c.status===status))return;
      if(isBusy()){error='请等待当前排查或追问完成，再保存反馈。';update();return;}
      if(note.value.length>2000){error='未保存 · 备注不能超过 2000 字。';update();return;}
      const submitted={status,note:note.value};saving=true;error='';update();
      try{const result=await save(submitted);saved={status:result.feedback.status,note:result.feedback.note||''};onSaved(result);}
      catch(e){error='未保存 · 保存失败：'+e.message;}
      finally{saving=false;update();}
    };
    find('#real-retry').onclick=()=>{
      if(saving)return;
      if(isBusy()){error='请等待当前排查或追问完成，再重新分析。';update();return;}
      if(dirty()){error='未保存 · 请先选择处理结果并保存反馈，再重新分析。';update();return;}
      retry();
    };
    update();
    return {refresh:update,getDraft:()=>({status,note:note.value}),setDraft:draft=>{status=draft.status;note.value=draft.note;update();}};
  }
  return {render,bind};
})();
