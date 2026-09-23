/* Shared validation and append-only conversation updates. */
(() => {
  function append(report,input){
    const turn=input?.turn,turns=report.followups||[];
    if(!turn||typeof turn.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(turn.id)||typeof turn.question!=='string'||!turn.question.trim()||turn.question.length>4000||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>30000||typeof turn.model!=='string'||turn.model.length>200||!Number.isFinite(Date.parse(turn.createdAt)))throw Error('追问记录格式无效');
    const images=turn.images===undefined?[]:PayTraceImages.validate(turn.images);
    if(turn.logQuery&&(!Array.isArray(turn.logQuery.evidence)||turn.logQuery.evidence.length>100||!Array.isArray(turn.logQuery.coverage)||JSON.stringify(turn.logQuery).length>120000))throw Error('补查日志格式无效或过长');
    if((input.revision??0)!==(report.revision??0))throw Error('日志证据已更新，请重新打开报告后追问');
    const existing=turns.find(t=>t.id===turn.id);
    if(existing){if(existing.question!==turn.question||existing.text!==turn.text||JSON.stringify(existing.logQuery)!==JSON.stringify(turn.logQuery)||JSON.stringify(existing.images||[])!==JSON.stringify(images))throw Error('追问记录冲突，请重新打开报告');return report;}
    if(input.expectedCount!==turns.length)throw Error('对话已更新，请重新打开报告后追问');
    report.followups=[...turns,{id:turn.id,question:turn.question,text:turn.text,model:turn.model,createdAt:turn.createdAt,...(images.length?{images}:{}),...(turn.logQuery?{logQuery:structuredClone(turn.logQuery)}:{})}];return report;
  }
  function context(report){
    const turns=report.followups||[],recent=[];let size=0,imageCount=0;
    for(let i=turns.length-1;i>=0&&recent.length<12;i--){
      const t=turns[i];if(typeof t?.question!=='string'||typeof t.text!=='string')throw Error('追问记录格式无效');
      const images=t.images===undefined?[]:PayTraceImages.validate(t.images);
      size+=t.question.length+t.text.length;imageCount+=images.length;if(size>60000||imageCount>10)break;recent.unshift({question:t.question,text:t.text,...(images.length?{images}:{})});
    }
    return {turns:recent,omitted:turns.length-recent.length,latestLogQuery:[...turns].reverse().find(t=>t.logQuery)?.logQuery};
  }
  globalThis.PayTraceFollowup={append,context};
})();
