/* 浏览器内演示数据层；后续替换为后端 API，不包含真实支付数据。 */
(() => {
  const prefix='paytrace.frontend.v1.';
  const memory={};
  function read(key,fallback){try{return JSON.parse(localStorage.getItem(prefix+key))??structuredClone(fallback)}catch{return structuredClone(memory[key]??fallback)}}
  function save(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value))}catch{memory[key]=structuredClone(value)}}
  const transactions=[
    {id:'T202609200001',merchant:'海风跨境 · 演示商户',amount:'128.00',currency:'USD',status:'SUCCESS',channel:'Worldpay · 模拟',time:'2026-09-20 10:23:01',channelId:'CH99881',scenario:'支付成功，商户未收到通知',question:'客户已扣款，为什么商户订单还在处理中？'},
    {id:'T202609200002',merchant:'北辰出海 · 演示商户',amount:'56.80',currency:'EUR',status:'FAILED',channel:'Worldpay · 模拟',time:'2026-09-20 10:25:01',channelId:'CH99882',scenario:'渠道明确拒绝',question:'这笔支付为什么失败，应该如何跟客户解释？'},
    {id:'T202609200003',merchant:'海风跨境 · 演示商户',amount:'299.00',currency:'USD',status:'PROCESSING',channel:'Worldpay · 模拟',time:'2026-09-20 10:28:01',channelId:'CH99883',scenario:'渠道超时，最终状态未知',question:'交易一直处理中，可以直接让客户重新付款吗？'}
  ];
  const defaults=['trx','daemon'].map(name=>({name,project:'外卡支付',environment:'演示',logFile:`logs/${name}.log`,version:'demo-v1',enabled:true}));
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
  function investigate(body){
    const transaction=transactions.find(t=>t.id===(body.transactionId||'').trim());
    if(!transaction)throw Error('未找到演示交易，请选择下方三个样例之一');
    const config=read('services',defaults),evidence=search('trx',transaction.id,config);
    const steps=[{title:'定位交易',detail:'在浏览器内的模拟交易数据中定位流水号',count:1},{title:'检索 trx 日志',detail:'匹配内置样例日志，排除其他交易干扰行',count:evidence.length}];
    const ids=[...new Set(evidence.map(e=>e.text.match(/messageId=(\S+)/)?.[1]).filter(Boolean))];
    ids.forEach(id=>{const found=search('daemon',id,config);evidence.push(...found);steps.push({title:'追踪 daemon',detail:`使用 trx 中的消息标识 ${id} 关联模拟通知日志`,count:found.length})});
    evidence.forEach((e,i)=>e.id='E'+(i+1));
    const has=event=>evidence.some(e=>e.text.split(/\s+/).includes('event='+event));
    let diagnosis='待核实',title='当前证据不足，无法确定异常原因',summary='已定位交易，但当前启用的数据源未提供完整证据。请检查服务开关与日志覆盖范围。',actions=['检查对应服务是否启用，确认日志覆盖范围。','将现有证据交给开发继续排查，不要依据日志缺失判断支付失败。'],uncertainties=['没有查到日志不代表业务未执行。'],code={};
    if(has('CHANNEL_SUCCESS')&&has('RETRY_EXHAUSTED')){
      diagnosis='已定位';title='支付已成功，商户通知重试耗尽';summary='模拟交易与 trx 证据显示支付成功。沿 MSG77662 追踪 daemon 后，发现商户通知连续三次超时，最终进入人工复核。该现象可以解释商户订单仍在处理中的问题。';
      actions=['联系商户核实通知接口可用性与订单实际状态。','确认回调地址和网络连通性；恢复后由授权人员按既有流程补发通知。','补发前核实幂等处理；不要因通知失败重复发起扣款。'];
      uncertainties=['超时无法证明商户未处理请求，也不能区分网络异常、服务不可用或响应过慢。'];
      code={file:'demo/NotificationPolicy.java',version:'demo-v1',text:'// 演示业务策略\nif (acknowledged) return "DELIVERED";\nif (attempts >= 3) return "MANUAL_REVIEW";\nreturn "RETRY";'};
      steps.push({title:'核对业务规则',detail:'演示策略：3 次未确认后进入人工复核',count:1});
    }else if(has('CHANNEL_DECLINED')){
      diagnosis='已定位';title='渠道返回拒绝，具体发卡行原因待确认';summary='样例日志显示返回码 05（演示映射：Do not honor），模拟交易状态为失败。这个通用拒绝码不能证明余额不足或卡片冻结。';
      actions=['向用户说明支付被渠道拒绝，建议联系发卡行核实。','若用户反馈已扣款，携带渠道流水号进入核查流程。','避免将通用拒绝码解释为余额不足，不自动重复扣款。'];uncertainties=['发卡行具体拒绝原因未知；生产解释需依据实际渠道文档。'];
    }else if(has('CHANNEL_TIMEOUT')){
      title='渠道请求超时，最终支付状态未知';summary='模拟日志只证明未在等待时间内取得渠道结果，交易仍在处理中。请求超时不等于支付失败，也不能证明用户未被扣款。';
      actions=['通过渠道流水号查询最终结果，或等待有效异步回调。','在结果明确前，不建议用户重新付款，也不直接修改订单状态。','超过业务等待时限后，将证据与渠道流水号交给开发或渠道支持。'];uncertainties=['尚无渠道最终结果或有效异步回调证据。'];
    }
    steps.push({title:'形成模拟报告',detail:'当前为前端预设诊断，未请求真实服务器或大模型',count:evidence.length});
    const report={id:globalThis.crypto?.randomUUID?.()||'demo-'+Date.now()+'-'+Math.random().toString(16).slice(2),createdAt:new Date().toISOString(),transaction,question:body.question||'',diagnosis,title,summary,actions,uncertainties,code,evidence,steps,mode:'前端模拟诊断 · 未连接后端',durationMs:0,feedback:{},ai:{status:'disabled',text:'当前为纯前端原型，未接入 AI。以上结论由样例数据与预设规则生成。'}};
    const reports=read('reports',[]);reports.unshift(report);save('reports',reports.slice(0,200));return report;
  }
  window.demoApi=async(path,method='GET',body)=>{
    if(path==='/transactions')return structuredClone(transactions);
    if(path==='/status')return {enabled:false,model:'未接入',provider:'前端原型'};
    if(path==='/services'){
      if(method==='PUT'){if(!Array.isArray(body)||body.length!==2||!defaults.every(d=>body.filter(s=>s.name===d.name&&s.logFile===d.logFile&&typeof s.enabled==='boolean').length===1))throw Error('服务配置无效');save('services',body)}
      return read('services',defaults);
    }
    if(path==='/investigations')return method==='POST'?investigate(body):read('reports',[]);
    const match=path.match(/^\/investigations\/([^/]+)(\/feedback)?$/);
    if(match){const reports=read('reports',[]),report=reports.find(r=>r.id===match[1]);if(!report)throw Error('排查记录不存在');if(match[2]&&method==='POST'){if(!['已解决','需要开发介入','判断不正确'].includes(body.status))throw Error('请选择处理结果');report.feedback={status:body.status,note:String(body.note||'').slice(0,2000),time:new Date().toISOString()};save('reports',reports)}return report}
    throw Error('未找到对应演示数据');
  };
})();
