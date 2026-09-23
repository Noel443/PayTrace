// Capture the environment once per page so in-flight requests cannot switch targets.
(() => {
  let selected;
  try{selected=sessionStorage.getItem('paytrace.environment')}catch{}
  if(!['test','production'].includes(selected))selected=null;
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(selected&&url.origin===location.origin&&url.pathname.startsWith('/api/')){
      const headers=new Headers(options.headers||(typeof input!=='string'?input.headers:undefined));
      headers.set('X-PayTrace-Environment',selected);
      options={...options,headers};
    }
    return originalFetch(input,options);
  };
  window.paytraceEnvironment={reset(){try{sessionStorage.removeItem('paytrace.environment')}catch{}selected=null},switchTo(value){
    if(!['test','production'].includes(value))return;
    try{sessionStorage.setItem('paytrace.environment',value)}catch{alert('无法保存环境选择，请允许当前标签页使用会话存储');return}
    location.reload();
  }};
})();
