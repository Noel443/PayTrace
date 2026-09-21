(async()=>{
  try{
    const driver=await PayTraceAuth.ready;window.storageDriver=driver;if(!PayTraceAuth.signedIn())return;
    const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./'+src+'.js';script.onload=resolve;script.onerror=()=>reject(Error('页面脚本加载失败，请刷新'));document.body.append(script)});
    for(const src of ['workspaces','investigation','local-api','stream','evidence-graph'])await load(src);
    if(driver==='mysql'){await load('mysql-browser');await window.initializeMysqlBrowser()}
    for(const src of ['app','workspace-settings','project-settings'])await load(src);
  }catch(e){const error=document.createElement('p');error.setAttribute('role','alert');error.style.visibility='visible';error.textContent='工作台初始化失败：'+e.message;document.body.prepend(error)}
})();
