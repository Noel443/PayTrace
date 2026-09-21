/* MySQL 模式使用服务端会话；未配置数据库时保留本地演示入口。 */
(() => {
  const key='paytrace.session.v1';let driver='local',current=null;
  async function request(path,body){const r=await fetch('/api/auth/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Error(value.message||'登录服务不可用');return value}
  function signedIn(){if(driver==='mysql')return !!current;try{return JSON.parse(sessionStorage.getItem(key))?.user==='admin'}catch{return false}}
  function check(){if(!document.documentElement.hasAttribute('data-auth-required'))return;if(signedIn())document.documentElement.dataset.authenticated='true';else location.replace('./login.html')}
  const ready=(async()=>{
    if(location.protocol!=='file:'){
      const response=await fetch('/api/storage');if(!response.ok)throw Error('无法确认存储模式，请检查服务');driver=(await response.json()).driver;
      if(driver==='mysql')current=(await request('session')).user;
    }
    check();return driver;
  })();
  ready.catch(()=>{document.addEventListener('DOMContentLoaded',()=>{const error=document.querySelector('#login-error');if(error)error.textContent='服务连接失败，请检查 npm start 后刷新页面'},{once:true})});
  async function login(username,password){await ready;if(driver==='mysql'){current=(await request('login',{username,password})).user;return}if(username!=='admin'||password!=='admin')throw Error('账号或密码不正确，请重新输入');sessionStorage.setItem(key,JSON.stringify({user:'admin'}))}
  async function logout(){try{await ready;if(driver==='mysql'){await request('logout',{});current=null}else sessionStorage.removeItem(key);window.dispatchEvent(new Event('paytrace:logout'));location.replace('./login.html')}catch(e){alert(e.message)}}
  window.PayTraceAuth={signedIn,login,logout,ready};
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
  document.addEventListener('DOMContentLoaded',()=>document.querySelector('#logout')?.addEventListener('click',logout));
})();
