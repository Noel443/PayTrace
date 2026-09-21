/* 浏览器内演示数据层；后续替换为后端 API，不包含真实支付数据。 */
(() => {
  const prefix='paytrace.frontend.v1.';
  const storageKey=(key,workspace='card')=>prefix+(workspace==='card'?'':workspace+'.')+key;
  function read(key,fallback,workspace='card'){const k=storageKey(key,workspace);try{const value=JSON.parse(localStorage.getItem(k))??structuredClone(fallback);if(key==='reports'&&workspace==='hk-cb')return value.map(r=>({...r,workspaceName:'MSO'}));return value}catch{return structuredClone(fallback)}}
  function save(key,value,workspace='card'){try{localStorage.setItem(storageKey(key,workspace),JSON.stringify(value))}catch{throw Error('本地存储不可用或空间不足，本次未保存，请检查浏览器存储后重试')}}
  const transactions=[
    {id:'T202609200001',merchant:'海风跨境',amount:'128.00',currency:'USD',status:'SUCCESS',channel:'Worldpay',time:'2026-09-20 10:23:01',channelId:'CH99881',scenario:'支付成功，商户未收到通知',question:'客户已扣款，为什么商户订单还在处理中？'},
    {id:'T202609200002',merchant:'北辰出海',amount:'56.80',currency:'EUR',status:'FAILED',channel:'Worldpay',time:'2026-09-20 10:25:01',channelId:'CH99882',scenario:'渠道明确拒绝',question:'这笔支付为什么失败，应该如何跟客户解释？'},
    {id:'T202609200003',merchant:'海风跨境',amount:'299.00',currency:'USD',status:'PROCESSING',channel:'Worldpay',time:'2026-09-20 10:28:01',channelId:'CH99883',scenario:'渠道超时，最终状态未知',question:'交易一直处理中，可以直接让客户重新付款吗？'}
  ];
  const defaults=['trx','daemon'].map(name=>({name,project:'外卡支付',environment:'沙箱',logFile:`logs/${name}.log`,version:'v1.0',enabled:true}));
  const logs={trx:[
    '2026-09-20T10:23:01 INFO transaction=T202609200001 event=ACCEPTED amount=128.00 currency=USD',
    '2026-09-20T10:23:02 INFO transaction=T202609200001 channelId=CH99881 event=CHANNEL_SUCCESS status=SUCCESS',
    '2026-09-20T10:23:02 INFO transaction=OTHER00001 event=CHANNEL_DECLINED channelCode=05',
    '2026-09-20T10:23:03 INFO transaction=T202609200001 messageId=MSG77662 event=NOTIFY_ENQUEUED target=daemon',
    '2026-09-20T10:25:01 INFO transaction=T202609200002 event=ACCEPTED amount=56.80 currency=EUR',
    '2026-09-20T10:25:02 WARN transaction=T202609200002 channelId=CH99882 event=CHANNEL_DECLINED channelCode=05',
    '2026-09-20T10:28:01 INFO transaction=T202609200003 event=ACCEPTED amount=299.00 currency=USD',
    '2026-09-20T10:28:31 WARN transaction=T202609200003 channelId=CH99883 event=CHANNEL_TIMEOUT finalStatus=UNKNOWN'
  ],daemon:[
    '2026-09-20T10:23:04 INFO messageId=MSG77662 event=NOTIFY_STARTED attempt=1',
    '2026-09-20T10:23:09 ERROR messageId=MSG77662 event=NOTIFY_TIMEOUT attempt=1 timeoutMs=5000',
    '2026-09-20T10:23:10 INFO messageId=OTHERMSG event=NOTIFY_SUCCESS httpStatus=200',
    '2026-09-20T10:24:09 ERROR messageId=MSG77662 event=NOTIFY_TIMEOUT attempt=2 timeoutMs=5000',
    '2026-09-20T10:26:09 ERROR messageId=MSG77662 event=NOTIFY_TIMEOUT attempt=3 timeoutMs=5000',
    '2026-09-20T10:26:10 WARN messageId=MSG77662 event=RETRY_EXHAUSTED attempts=3 nextAction=MANUAL_REVIEW'
  ]};
  function search(service,key,config){if(!config.find(s=>s.name===service)?.enabled)return [];return logs[service].flatMap((text,i)=>text.split(/\s+/).some(token=>['transaction','messageId'].some(field=>token===`${field}=${key}`))?[{service,file:`logs/${service}.log`,line:i+1,text,matchedBy:key,context:logs[service].slice(Math.max(0,i-1),i+2).join('\n')}]:[])}
  function investigate(body,workspace='card'){
    if(workspace!=='card'){const report=window.workspaceData.report(workspace,body,read('services',window.workspaceData.services(workspace),workspace));const reports=read('reports',[],workspace);reports.unshift(report);save('reports',reports.slice(0,200),workspace);return report;}
    const transaction=transactions.find(t=>t.id===(body.transactionId||'').trim());
    if(!transaction)throw Error('当前数据范围内未找到该交易，请选择业务案例或核对流水号');
    const config=read('services',defaults),evidence=search('trx',transaction.id,config);
    const steps=[{title:'定位交易',detail:'按流水号定位交易记录',count:1},{title:'检索 trx 日志',detail:'匹配交易日志，排除其他交易干扰行',count:evidence.length}];
    const ids=[...new Set(evidence.map(e=>e.text.match(/messageId=(\S+)/)?.[1]).filter(Boolean))];
    ids.forEach(id=>{const found=search('daemon',id,config);evidence.push(...found);steps.push({title:'追踪 daemon',detail:`使用 trx 中的消息标识 ${id} 关联通知日志`,count:found.length})});
    evidence.forEach((e,i)=>e.id='E'+(i+1));
    const has=event=>evidence.some(e=>e.text.split(/\s+/).includes('event='+event));
    let diagnosis='待核实',title='当前证据不足，无法确定异常原因',summary='已定位交易，但当前启用的数据源未提供完整证据。请检查服务开关与日志覆盖范围。',actions=['检查对应服务是否启用，确认日志覆盖范围。','将现有证据交给开发继续排查，不要依据日志缺失判断支付失败。'],uncertainties=['没有查到日志不代表业务未执行。'],code={};
    if(has('CHANNEL_SUCCESS')&&has('RETRY_EXHAUSTED')){
      diagnosis='已定位';title='支付已成功，商户通知重试耗尽';summary='交易记录与 trx 证据显示支付成功。沿 MSG77662 追踪 daemon 后，发现商户通知连续三次超时，最终进入人工复核。该现象可以解释商户订单仍在处理中的问题。';
      actions=['联系商户核实通知接口可用性与订单实际状态。','确认回调地址和网络连通性；恢复后由授权人员按既有流程补发通知。','补发前核实幂等处理；不要因通知失败重复发起扣款。'];
      uncertainties=['超时无法证明商户未处理请求，也不能区分网络异常、服务不可用或响应过慢。'];
      code={file:'业务规则 / NotificationPolicy',version:'v1.0',text:'// 通知重试策略\nif (acknowledged) return "DELIVERED";\nif (attempts >= 3) return "MANUAL_REVIEW";\nreturn "RETRY";'};
      steps.push({title:'核对业务规则',detail:'3 次未确认后进入人工复核',count:1});
    }else if(has('CHANNEL_DECLINED')){
      diagnosis='已定位';title='渠道返回拒绝，具体发卡行原因待确认';summary='日志显示返回码 05（当前规则映射：Do not honor），交易状态为失败。这个通用拒绝码不能证明余额不足或卡片冻结。';
      actions=['向用户说明支付被渠道拒绝，建议联系发卡行核实。','若用户反馈已扣款，携带渠道流水号进入核查流程。','避免将通用拒绝码解释为余额不足，不自动重复扣款。'];uncertainties=['发卡行具体拒绝原因未知；生产解释需依据实际渠道文档。'];
    }else if(has('CHANNEL_TIMEOUT')){
      title='渠道请求超时，最终支付状态未知';summary='日志仅证明未在等待时间内取得渠道结果，交易仍在处理中。请求超时不等于支付失败，也不能证明用户未被扣款。';
      actions=['通过渠道流水号查询最终结果，或等待有效异步回调。','在结果明确前，不建议用户重新付款，也不直接修改订单状态。','超过业务等待时限后，将证据与渠道流水号交给开发或渠道支持。'];uncertainties=['尚无渠道最终结果或有效异步回调证据。'];
    }
    steps.push({title:'生成排查报告',detail:'依据关联证据与业务规则生成结论',count:evidence.length});
    const report={id:globalThis.crypto?.randomUUID?.()||'demo-'+Date.now()+'-'+Math.random().toString(16).slice(2),workspaceId:'card',workspaceName:'外卡支付',createdAt:new Date().toISOString(),transaction,question:body.question||'',diagnosis,title,summary,actions,uncertainties,code,evidence,steps,mode:'规则诊断 · 沙箱数据',durationMs:0,feedback:{},ai:{status:'disabled',text:'本报告尚未执行 AI 分析。可调用已配置的模型，对问题、证据和业务文档进行补充分析。'}};
    const reports=read('reports',[]);reports.unshift(report);save('reports',reports.slice(0,200));return report;
  }
  window.demoApi=async(path,method='GET',body,workspace='card')=>{
    window.workspaceData.get(workspace);
    const serviceDefaults=workspace==='card'?defaults:window.workspaceData.services(workspace);
    if(path==='/knowledge'){
      if(method==='PUT'){
        if(typeof body?.scanEnabled!=='boolean'||!Array.isArray(body.projects)||body.projects.length>20)throw Error('项目配置无效');
        const projects=body.projects.map(p=>({name:String(p.name||'').trim(),path:String(p.path||'').trim(),branch:String(p.branch||'').trim()||'master'}));
        if(projects.some(p=>!p.name||!p.path||p.name.length>100||p.path.length>1000||p.branch.length>200))throw Error('请完整填写项目名称和本地路径');
        if(body.scanEnabled&&!projects.length)throw Error('请先添加一个本地项目');
        const markdown=String(body.markdown||'');
        if(markdown.length>100000)throw Error('Markdown 文档请控制在 10 万字以内');
        const knowledge={scanEnabled:body.scanEnabled,projects,markdown,updatedAt:new Date().toISOString()};
        try{localStorage.setItem(storageKey('knowledge',workspace),JSON.stringify(knowledge))}catch{throw Error('浏览器本地存储不可用或空间不足，未保存。请下载 Markdown 备份后重试。')}
      }
      const defaults=window.workspaceData.knowledge(workspace),knowledge=read('knowledge',defaults,workspace);
      if(method!=='PUT'&&!knowledge.updatedAt&&!String(knowledge.markdown||'').trim())return {...knowledge,markdown:defaults.markdown,updatedAt:null,usingDefault:true};
      return {...knowledge,usingDefault:!knowledge.updatedAt&&knowledge.markdown===defaults.markdown};
    }
    if(path==='/transactions')return structuredClone(workspace==='card'?transactions:window.workspaceData.get(workspace).cases);
    if(path==='/status')return {enabled:false,model:'未接入',provider:'前端原型'};
    if(path==='/services'){
      if(method==='PUT'){if(!Array.isArray(body)||body.length!==serviceDefaults.length||!serviceDefaults.every(d=>body.filter(s=>s.name===d.name&&s.logFile===d.logFile&&typeof s.enabled==='boolean').length===1))throw Error('服务配置无效');save('services',body,workspace)}
      return read('services',serviceDefaults,workspace);
    }
    if(path==='/investigations'&&method==='DELETE'){
      const ids=body?.ids,reports=read('reports',[],workspace);
      if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('请选择有效的排查记录');
      if(ids.some(id=>!reports.some(r=>r.id===id)))throw Error('部分排查记录已不存在，请刷新列表后重试');
      const selected=new Set(ids);save('reports',reports.filter(r=>!selected.has(r.id)),workspace);return {deleted:ids.length};
    }
    if(path==='/investigations')return method==='POST'?investigate(body,workspace):read('reports',[],workspace);
    const supplementMatch=path.match(/^\/investigations\/([^/]+)\/supplement$/);
    if(supplementMatch&&method==='POST'){
      const reports=read('reports',[],workspace),report=reports.find(r=>r.id===supplementMatch[1]);
      if(!report)throw Error('排查记录不存在');
      window.investigation.supplement(report,body);
      try{localStorage.setItem(storageKey('reports',workspace),JSON.stringify(reports))}catch{throw Error('浏览器存储失败，补证未保存，请检查空间后重试')}
      return report;
    }
    const aiMatch=path.match(/^\/investigations\/([^/]+)\/ai$/);
    if(aiMatch&&method==='POST'){
      const reports=read('reports',[],workspace),report=reports.find(r=>r.id===aiMatch[1]);if(!report)throw Error('排查记录不存在');
      if(body?.status!=='completed'||typeof body.text!=='string'||body.text.length>30000)throw Error('AI 分析结果格式无效');
      if((body.revision??0)!==(report.revision??0))throw Error('证据已更新，本次 AI 结果已过期，请重新分析');
      report.ai=body;
      try{localStorage.setItem(storageKey('reports',workspace),JSON.stringify(reports))}catch{throw Error('AI 已返回，但浏览器存储失败，请检查剩余空间后重试')}
      return report;
    }
    const match=path.match(/^\/investigations\/([^/]+)(\/feedback)?$/);
    if(match){const reports=read('reports',[],workspace),report=reports.find(r=>r.id===match[1]);if(!report)throw Error('排查记录不存在');if(!match[2]&&method==='DELETE'){save('reports',reports.filter(r=>r.id!==report.id),workspace);return {deleted:true}}if(match[2]&&method==='POST'){if(!['已解决','需要开发介入','判断不正确'].includes(body.status))throw Error('请选择处理结果');report.feedback={status:body.status,note:String(body.note||'').slice(0,2000),time:new Date().toISOString()};save('reports',reports,workspace)}return report}
    throw Error('未找到对应数据');
  };
})();
