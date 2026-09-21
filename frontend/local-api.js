/* 浏览器本地配置与记录存储；不生成模拟交易或日志。 */
(() => {
  const isDemoReport=r=>/^(?:T|CB|HK)20260920000[1-3]$/.test(r?.transaction?.id||'')||/沙箱|前端模拟/.test(r?.mode||'');
  const prefix='paytrace.frontend.v1.';
  const storageKey=(key,workspace='card')=>prefix+(workspace==='card'?'':workspace+'.')+key;
  function read(key,fallback,workspace='card'){const k=storageKey(key,workspace);try{let value=JSON.parse(localStorage.getItem(k))??structuredClone(fallback);if(key==='reports'&&Array.isArray(value)){const clean=value.filter(r=>!isDemoReport(r));if(clean.length!==value.length){try{localStorage.setItem(k,JSON.stringify(clean))}catch{}value=clean;}}if(key==='reports'&&workspace==='hk-cb')return value.map(r=>({...r,workspaceName:'MSO'}));return value}catch{return structuredClone(fallback)}}
  function save(key,value,workspace='card'){try{localStorage.setItem(storageKey(key,workspace),JSON.stringify(value))}catch{throw Error('本地存储不可用或空间不足，本次未保存，请检查浏览器存储后重试')}}
  for(const w of window.workspaceCatalog)read('reports',[],w.id);
  window.localApi=async(path,method='GET',body,workspace='card')=>{
    window.workspaceData.get(workspace);
    const serviceDefaults=window.workspaceData.services(workspace);
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
      return {...knowledge,usingDefault:false};
    }
    if(path==='/transactions')return [];
    if(path==='/status')return {enabled:false,model:'未接入',provider:'前端原型'};
    if(path==='/services'){
      if(method==='PUT'){if(!Array.isArray(body)||body.length!==serviceDefaults.length||!serviceDefaults.every(d=>body.filter(s=>s.name===d.name&&s.logFile===d.logFile&&typeof s.enabled==='boolean').length===1))throw Error('服务配置无效');save('services',body,workspace)}
      return serviceDefaults;
    }
    if(path==='/investigations'&&method==='DELETE'){
      const ids=body?.ids,reports=read('reports',[],workspace);
      if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('请选择有效的排查记录');
      if(ids.some(id=>!reports.some(r=>r.id===id)))throw Error('部分排查记录已不存在，请刷新列表后重试');
      const selected=new Set(ids);save('reports',reports.filter(r=>!selected.has(r.id)),workspace);return {deleted:ids.length};
    }
    if(path==='/investigations'){if(method==='POST')throw Error('真实交易查询与自动生成报告尚未接入，请先在服务配置中查询日志或分析项目');return read('reports',[],workspace);}
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
