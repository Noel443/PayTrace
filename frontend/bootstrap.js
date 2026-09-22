(async()=>{
  try{
    try{window.paytraceRuntime=await fetch('./api/runtime',{credentials:'same-origin'}).then(r=>r.ok?r.json():({environment:'test'}))}catch{window.paytraceRuntime={environment:'test'}}
    const runtime=window.paytraceRuntime;
    const label=document.querySelector('#environment-label'),switcher=document.querySelector('#switch-environment');
    if(runtime.production){label.textContent='生产环境 · 只读';document.title='PayTrace · 生产日志分析';}
    else label.textContent='测试环境';
    if(runtime.counterpartUrl){switcher.hidden=false;switcher.textContent=runtime.production?'切换测试环境':'切换生产环境';switcher.onclick=()=>{window.location.href=runtime.counterpartUrl}};
    if(runtime.production){
      document.querySelectorAll('[data-view="settings"],[data-view="history"]').forEach(el=>{el.hidden=true;el.disabled=true});
      document.querySelectorAll('#add-workspace,#edit-workspace,#delete-workspace').forEach(el=>{el.hidden=true;el.disabled=true});
      const settings=document.querySelector('#settings');if(settings)settings.hidden=true;
      const history=document.querySelector('#history');if(history)history.hidden=true;
    }
    const driver=await PayTraceAuth.ready;window.storageDriver=driver;if(!PayTraceAuth.signedIn())return;
    const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./'+src+'.js';script.onload=resolve;script.onerror=()=>reject(Error('页面脚本加载失败，请刷新'));document.body.append(script)});
    for(const src of ['workspaces','investigation','followup-data','local-api','stream','evidence-graph'])await load(src);
    if(driver==='mysql'){await load('mysql-browser');await window.initializeMysqlBrowser()}
    for(const src of ['followup-ui','app','workspace-settings','project-settings'])await load(src);
  }catch(e){const error=document.createElement('p');error.setAttribute('role','alert');error.style.visibility='visible';error.textContent='工作台初始化失败：'+e.message;document.body.prepend(error)}
})();
