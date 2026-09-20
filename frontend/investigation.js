/* 可解释的演示规则；所有新增证据均为内置样例，不查询商户系统。 */
(() => {
  function inspect(r) {
    const event=name=>r.evidence.find(e=>e.text.split(/\s+/).includes('event='+name));
    const success=event('CHANNEL_SUCCESS'), declined=event('CHANNEL_DECLINED');
    const merchant=r.supplement;
    return {
      parties:[
        {name:'渠道侧',state:success?'支付成功':declined?'支付拒绝':'最终结果未知',detail:success||declined?'依据留存的渠道响应记录，未直连渠道。':'缺少渠道最终结果，超时不等于失败。',refs:[success?.id||declined?.id].filter(Boolean)},
        {name:'支付平台',state:({SUCCESS:'支付成功',FAILED:'支付失败',PROCESSING:'处理中'})[r.transaction.status]||'待核实',detail:'依据交易记录；商户订单状态独立核实。',refs:['交易记录']},
        {name:'商户侧',state:merchant?(merchant.outcome==='completed'?'订单已完成':'订单仍待支付'):'订单状态待核实',detail:merchant?'依据补充的查单记录；仅代表该次查询时点。':'未收到通知确认，不代表商户没有处理。',refs:merchant?[merchant.id]:[]}
      ],
      next:merchant?(merchant.outcome==='completed'?'核查通知确认链路':'核查商户接收日志与订单更新记录'):r.transaction.id==='T202609200001'?'查询商户订单状态':'T202609200003'===r.transaction.id?'通过渠道流水号查询最终结果':'向渠道或发卡行核实具体拒绝原因',
      canSupplement:r.transaction.id==='T202609200001',
      hypotheses:merchant?(merchant.outcome==='completed'?['“商户订单仍未完成”已被新增查单样例排除。','通知响应为何未确认仍待核实，不能断言响应丢失。']:['新增查单样例支持“商户订单仍未完成”。','是否收到通知、为何未更新，仍需商户接收日志。']):['商户尚未完成订单：需要商户查单证据。','商户已经完成订单，通知响应未确认：同样需要商户查单证据。']
    };
  }
  function supplement(r,body) {
    if(r.transaction.id!=='T202609200001')throw Error('当前案例暂不支持商户补证');
    if(r.supplement)throw Error('本次排查已补证；请重新发起排查以核实其他状态');
    if(!['completed','pending'].includes(body?.outcome))throw Error('请选择有效的商户查单结果');
    if((body.revision??0)!==(r.revision??0))throw Error('报告已更新，请重新打开');
    const completed=body.outcome==='completed',at=new Date().toISOString();
    const id='E'+(Math.max(0,...r.evidence.map(e=>Number(e.id.slice(1))||0))+1);
    r.original={title:r.title,summary:r.summary,actions:[...r.actions],uncertainties:[...r.uncertainties]};
    r.supplement={id,outcome:body.outcome,addedAt:at,observedAt:'2026-09-20T10:30:00+08:00',source:'商户查单记录 · 沙箱预设'};
    r.evidence.push({id,service:'merchant-demo',file:'demo/merchant-query.json',line:1,matchedBy:r.transaction.id,text:`2026-09-20T10:30:00+08:00 transaction=${r.transaction.id} event=MERCHANT_ORDER_QUERY orderStatus=${completed?'COMPLETED':'PENDING'} source=DEMO`,context:'内置商户查单样例；查询时点为 2026-09-20 10:30:00（UTC+08:00），不证明其他时点的订单状态。'});
    r.title=completed?'商户订单已完成，通知确认链路仍待核实':'支付成功，商户订单仍待支付';
    r.diagnosis='待核实';
    r.summary=completed?`新增商户查单记录 [${id}] 显示订单已完成，排除查询时点“订单仍未完成”的假设。原有通知日志保持不变；商户如何完成订单、通知响应为何未确认仍未知。`:`新增商户查单记录 [${id}] 显示订单仍待支付，与平台支付成功状态存在分歧。该证据不能证明商户未收到通知，也不能单独确定根因。`;
    r.actions=completed?['核对商户订单与本笔支付的映射，确认履约情况。','核查商户响应、网络与平台确认记录，定位通知确认问题。','不要仅因通知超时再次扣款或补发；如需补发，先按既有流程核实必要性与幂等。']:['核对商户订单映射、通知接收日志与订单更新记录。','确认接口恢复、商户处理状态与幂等条件后，由授权人员评估补发。','保留平台支付成功状态，不因商户待支付而重复扣款。'];
    r.uncertainties=completed?['订单完成途径未知，不能断言是本次通知促成。','通知响应未确认的原因仍未知。']:['商户是否收到或处理通知尚未确认。','未更新订单的具体原因及补发前提仍需核实。'];
    if(!r.evidence.some(e=>e.text.includes('event=RETRY_EXHAUSTED')))r.uncertainties.push('当前报告缺少完整通知重试证据，需补齐日志覆盖。');
    r.revision=(r.revision??0)+1;
    r.steps.push({title:'补充商户查单记录',detail:`[${id}] ${completed?'订单已完成':'订单仍待支付'}；按业务规则更新结论，未调用 AI`,count:1});
    r.ai={status:'disabled',text:'证据已更新，旧 AI 分析不再适用于当前报告。可重新调用真实 AI。'};
    return r;
  }
  window.investigation={inspect,supplement};
})();
