/* 节点状态仅由当前报告的精确关联记录决定，预期路径不证明步骤已执行。 */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mappings={
    CB202609200001:{REMIT_REQUEST:0,AGREEMENT_EXPIRED:1},
    CB202609200002:{TASK_DISPATCH:0,FILE_CREATED:2,UPLOAD_FAILED:3},
    CB202609200003:{CUSTOMS_ACCEPTED:0,CUSTOMS_QUERY:3,RETRY_NOT_DUE:4},
    HK202609200001:{PAYMENT_CONFIRMED:0,DETAIL_DISPATCH:2,DETAIL_PENDING:3},
    HK202609200002:{RECEIVER_CREATED:0,REPORT_TASK_RECEIVED:2,REPORT_LOCK_TIMEOUT:3},
    HK202609200003:{VA_APPLY_ACCEPTED:0,VA_CALLBACK:3,INTERFLOW_NOT_FOUND:3}
  };
  const failures=new Set(['CHANNEL_DECLINED','RETRY_EXHAUSTED','AGREEMENT_EXPIRED','UPLOAD_FAILED','INTERFLOW_NOT_FOUND']);
  const pending=new Set(['CHANNEL_TIMEOUT','NOTIFY_TIMEOUT','CUSTOMS_QUERY','RETRY_NOT_DUE','DETAIL_PENDING','REPORT_LOCK_TIMEOUT']);
  const labels={observed:'已有记录',alert:'异常记录',pending:'需要核实',unknown:'暂无证据'};
  function build(report){
    const steps=report.pipeline||[
      {label:'交易受理',service:'trx',detail:'支付请求受理记录'},
      {label:'渠道响应',service:'trx',detail:'平台留存的渠道响应，未直连渠道'},
      {label:'通知入队',service:'trx',detail:'按消息 ID 关联异步通知'},
      {label:'通知处理',service:'daemon',detail:'通知发起、超时与重试记录'},
      {label:'商户订单',service:'merchant-demo',detail:'商户查单证据；通知超时不能推断订单状态'}
    ];
    const mapping=report.pipeline?(mappings[report.transaction.id]||{}):{ACCEPTED:0,CHANNEL_SUCCESS:1,CHANNEL_DECLINED:1,CHANNEL_TIMEOUT:1,NOTIFY_ENQUEUED:2,NOTIFY_STARTED:3,NOTIFY_TIMEOUT:3,RETRY_EXHAUSTED:3,NOTIFY_SUCCESS:3,MERCHANT_ORDER_QUERY:4};
    const nodes=steps.map((p,index)=>({...p,index,evidence:[]}));
    for(const e of report.evidence){
      const event=e.text.match(/(?:^|\s)event=(\S+)/)?.[1];let index=mapping[event];
      if(index===undefined){index=steps.length;if(!nodes[index])nodes.push({index,label:'其他关联记录',service:'关联数据源',detail:'尚未映射到业务节点的记录',evidence:[]});}
      nodes[index].evidence.push({...e,event});
    }
    for(const n of nodes){
      n.state=n.evidence.some(e=>failures.has(e.event))?'alert':n.evidence.some(e=>pending.has(e.event)||e.event==='MERCHANT_ORDER_QUERY'&&/orderStatus=PENDING(?:\s|$)/.test(e.text))?'pending':n.evidence.length?'observed':'unknown';
      n.stateLabel=labels[n.state];
    }
    return nodes;
  }
  function render(report){
    const nodes=build(report),width=nodes.length*200;
    return `<section class="evidence-graph" aria-label="交互式证据图谱"><div class="graph-heading"><div><span class="graph-kicker">EVIDENCE MAP</span><h2>交易证据图谱</h2><p>沿业务链路查看已知事实，点击节点定位证据。</p></div><button class="primary" id="graph-ai" type="button">AI 分析 ↗</button></div><div class="graph-legend"><span class="observed">已有记录</span><span class="alert">异常记录</span><span class="pending">需要核实</span><span class="unknown">暂无证据</span><small>${report.evidence.length} 条关联证据 · 沙箱数据</small></div><div class="graph-scroll" tabindex="0" aria-label="业务链路，可横向滚动"><div class="graph-canvas" style="width:${width}px"><svg viewBox="0 0 ${width} 176" aria-hidden="true"><defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#acb8cc"/></marker></defs>${nodes.slice(1).map((n,i)=>`<path d="M${i*200+182},88 L${(i+1)*200+18},88" marker-end="url(#graph-arrow)"/>`).join('')}</svg><div class="graph-nodes" style="grid-template-columns:repeat(${nodes.length},200px)">${nodes.map(n=>`<button type="button" class="graph-node ${n.state}" data-graph-node="${n.index}" aria-pressed="false" aria-controls="graph-inspector"><span class="graph-node-top"><small>${String(n.index+1).padStart(2,'0')}</small><span>${n.stateLabel}</span></span><strong>${esc(n.label)}</strong><small class="graph-service">${esc(n.service==='merchant-demo'?'商户查单':n.service)}</small><span class="graph-node-count">${n.evidence.length?`${n.evidence.length} 条证据 · 点击查看`:'待补充证据'}</span></button>`).join('')}</div></div></div><div id="graph-inspector" class="graph-inspector"></div><p class="graph-caption">连线表示预期业务路径，不代表步骤已执行；“暂无证据”不等于失败。渠道响应来自平台记录。</p></section>`;
  }
  function bind(report,{onEvidence,onAnalyze}){
    const root=document.querySelector('.evidence-graph');if(!root)return;
    const nodes=build(report),inspector=root.querySelector('#graph-inspector');
    function select(index){
      const node=nodes[index];root.querySelectorAll('[data-graph-node]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.graphNode)===index)));
      inspector.innerHTML=`<div class="graph-inspector-title"><h3>${esc(node.label)}</h3><span class="graph-state ${node.state}">${node.stateLabel}</span></div><p>${esc(node.detail)}</p>${node.evidence.length?`<div class="graph-evidence-list">${node.evidence.map(e=>`<button type="button" data-graph-evidence="${esc(e.id)}"><span>[${esc(e.id)}]</span><div><b>${esc(e.event||'关联记录')}</b><small>${esc(e.file)}:${e.line} · 匹配 ${esc(e.matchedBy)}</small></div><span>查看原文 ↗</span></button>`).join('')}</div>`:'<p class="graph-missing">当前报告没有该步骤的直接证据。请核实日志覆盖范围，或补充对应系统记录。</p>'}`;
    }
    root.addEventListener('click',event=>{
      const node=event.target.closest('[data-graph-node]');if(node)select(Number(node.dataset.graphNode));
      const evidence=event.target.closest('[data-graph-evidence]');if(evidence)onEvidence(evidence.dataset.graphEvidence);
    });
    root.querySelector('#graph-ai').addEventListener('click',onAnalyze);
    const focus=nodes.find(n=>n.state==='alert')||nodes.find(n=>n.state==='pending')||nodes[0];select(focus.index);
  }
  function highlight(ids){
    const report=globalThis.PayTraceGraph.current;if(!report)return;
    for(const node of build(report))if(node.evidence.some(e=>ids.includes(e.id))){
      const el=document.querySelector(`[data-graph-node="${node.index}"]`);if(!el)continue;
      el.classList.remove('ai-referenced');void el.offsetWidth;el.classList.add('ai-referenced');
    }
  }
  globalThis.PayTraceGraph={build,render,bind,highlight,current:null};
})();
