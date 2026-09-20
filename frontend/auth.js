/* 本地展示登录：仅控制页面入口，不是服务端鉴权。 */
(() => {
  const key='paytrace.session.v1';
  function signedIn(){try{return JSON.parse(sessionStorage.getItem(key))?.user==='admin'}catch{return false}}
  function check(){
    if(!document.documentElement.hasAttribute('data-auth-required'))return;
    if(signedIn())document.documentElement.dataset.authenticated='true';
    else{delete document.documentElement.dataset.authenticated;location.replace('./login.html')}
  }
  function login(username,password){
    if(username!=='admin'||password!=='admin')throw Error('账号或密码不正确，请重新输入');
    try{sessionStorage.setItem(key,JSON.stringify({user:'admin',signedInAt:new Date().toISOString()}))}
    catch{throw Error('当前浏览器无法保存登录状态，请允许站点存储后重试')}
  }
  function logout(){
    try{sessionStorage.removeItem(key)}catch{alert('无法清除登录状态，请关闭当前标签页');return;}
    window.dispatchEvent(new Event('paytrace:logout'));location.replace('./login.html');
  }
  window.PayTraceAuth={signedIn,login,logout};check();
  window.addEventListener('pageshow',check);
  document.addEventListener('DOMContentLoaded',()=>document.querySelector('#logout')?.addEventListener('click',logout));
})();
