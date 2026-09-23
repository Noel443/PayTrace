(async()=>{
  try{
    try{window.paytraceRuntime=await fetch('./api/runtime',{credentials:'same-origin'}).then(r=>r.ok?r.json():({environment:'test'}))}catch{window.paytraceRuntime={environment:'test'}}
    const runtime=window.paytraceRuntime;
    const label=document.querySelector('#environment-label'),switcher=document.querySelector('#switch-environment');
    if(runtime.production){label.textContent=runtime.readOnly?'生产环境 · 只读':'生产环境';document.title='PayTrace · 生产日志分析';}
    else label.textContent='测试环境';
    if(runtime.switchable){
      switcher.hidden=false;switcher.textContent=runtime.production?'切换测试环境':'切换生产环境';
      switcher.onclick=()=>{
        if(typeof busy!=='undefined'&&busy||window.workspaceMutation){alert('请等待当前排查或保存完成后切换环境');return}
        if(!confirm('切换环境会重新加载页面，未保存的编辑不会保留。是否继续？'))return;
        window.dispatchEvent(new Event('paytrace:logout'));
        window.paytraceEnvironment.switchTo(runtime.production?'test':'production');
      };
    }else{
      window.paytraceEnvironment.reset();
      if(runtime.counterpartUrl){switcher.hidden=false;switcher.textContent=runtime.production?'切换测试环境':'切换生产环境';switcher.onclick=()=>{window.location.href=runtime.counterpartUrl}}
      else if(runtime.switchHint){switcher.hidden=false;switcher.textContent='环境切换待配置';switcher.onclick=()=>alert(runtime.switchHint)}
    }
    if(runtime.readOnly){
      document.querySelectorAll('[data-view="settings"],[data-view="history"]').forEach(el=>{el.hidden=true;el.disabled=true});
      document.querySelectorAll('#add-workspace,#edit-workspace,#delete-workspace').forEach(el=>{el.hidden=true;el.disabled=true});
      const settings=document.querySelector('#settings');if(settings)settings.hidden=true;
      const history=document.querySelector('#history');if(history)history.hidden=true;
    }
    const driver=await PayTraceAuth.ready;window.storageDriver=driver;if(!PayTraceAuth.signedIn())return;
    const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./'+src+'.js';script.onload=resolve;script.onerror=()=>reject(Error('页面脚本加载失败，请刷新'));document.body.append(script)});
    for(const src of ['workspaces','investigation','followup-data','images','local-api','stream','evidence-graph'])await load(src);
    if(driver==='mysql'){await load('mysql-browser');await window.initializeMysqlBrowser()}
    for(const src of ['followup-ui','app','image-upload','workspace-settings','project-settings'])await load(src);
  }catch(e){const error=document.createElement('p');error.setAttribute('role','alert');error.style.visibility='visible';error.textContent='工作台初始化失败：'+e.message;document.body.prepend(error)}
})();
