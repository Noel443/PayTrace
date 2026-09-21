/* Shared validation and append-only conversation updates. */
(() => {
  function append(report,input){
    const turn=input?.turn,turns=report.followups||[];
    if(!turn||typeof turn.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(turn.id)||typeof turn.question!=='string'||!turn.question.trim()||turn.question.length>4000||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>30000||typeof turn.model!=='string'||turn.model.length>200||!Number.isFinite(Date.parse(turn.createdAt)))throw Error('追问记录格式无效');
    if((input.revision??0)!==(report.revision??0))throw Error('日志证据已更新，请重新打开报告后追问');
    const existing=turns.find(t=>t.id===turn.id);
    if(existing){if(existing.question!==turn.question||existing.text!==turn.text)throw Error('追问记录冲突，请重新打开报告');return report;}
    if(input.expectedCount!==turns.length)throw Error('对话已更新，请重新打开报告后追问');
    report.followups=[...turns,{id:turn.id,question:turn.question,text:turn.text,model:turn.model,createdAt:turn.createdAt}];return report;
  }
  function context(report){
    const turns=report.followups||[],recent=[];let size=0;
    for(let i=turns.length-1;i>=0&&recent.length<12;i--){
      const t=turns[i];if(typeof t?.question!=='string'||typeof t.text!=='string')throw Error('追问记录格式无效');
      size+=t.question.length+t.text.length;if(size>60000)break;recent.unshift({question:t.question,text:t.text});
    }
    return {turns:recent,omitted:turns.length-recent.length};
  }
  globalThis.PayTraceFollowup={append,context};
})();
