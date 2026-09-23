/* Character budgets shared by browser validation and the Node service. */
globalThis.PayTraceLimits=Object.freeze({question:200000,answer:160000,context:1200000,history:600000,historyTurns:24});
globalThis.PayTraceQuestionInput=element=>{
  element.maxLength=PayTraceLimits.question;
  element.addEventListener('paste',event=>{
    const text=event.clipboardData?.getData('text/plain')||'';
    const size=element.value.length-(element.selectionEnd-element.selectionStart)+text.length;
    if(size>PayTraceLimits.question){
      event.preventDefault();element.setCustomValidity('单次问题最多 20 万字符，本次粘贴未插入，请拆分材料');
      element.reportValidity();
    }else element.setCustomValidity('');
  });
  element.addEventListener('input',()=>element.setCustomValidity(element.value.length>PayTraceLimits.question?'单次问题最多 20 万字符':''));
};
// Backward-compatible checks for persisted reports that may omit the question.
globalThis.PayTraceReportCapacity=report=>{
  if(report?.question!==undefined&&(typeof report.question!=='string'||report.question.length>PayTraceLimits.question))throw Error('问题最多 20 万字符，报告未保存');
  if(typeof report?.ai?.text==='string'&&report.ai.text.length>PayTraceLimits.answer)throw Error('回答最多 16 万字符，报告未保存');
};
