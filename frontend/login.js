(async () => {
  let driver;try{driver=await PayTraceAuth.ready}catch{document.querySelector('#login-error').textContent='服务连接失败，请检查 npm start 后刷新页面';return}
  if(driver==='mysql')document.querySelector('.login-footnote').textContent='服务端登录会话有效期为 8 小时，初始账号请在首次使用后修改密码。';
  if(PayTraceAuth.signedIn()){location.replace('./index.html');return;}
  const slider=document.querySelector('#login-slider'),track=document.querySelector('#slider-track'),text=document.querySelector('#slider-text'),error=document.querySelector('#login-error');
  let verified=false;
  function reset(){verified=false;slider.disabled=false;slider.value='0';track.style.setProperty('--slide','0%');track.classList.remove('verified');text.textContent='向右滑动完成验证';slider.setAttribute('aria-valuetext','尚未验证');document.querySelector('#slider-status').textContent='尚未完成滑动验证'}
  slider.addEventListener('input',()=>{track.style.setProperty('--slide',slider.value+'%');error.textContent=''});
  slider.addEventListener('change',()=>{
    if(Number(slider.value)<100){reset();return;}
    verified=true;slider.disabled=true;track.classList.add('verified');text.textContent='✓ 验证通过';slider.setAttribute('aria-valuetext','验证通过');document.querySelector('#slider-status').textContent='模拟滑动验证已通过';
  });
  document.querySelector('#toggle-password').addEventListener('click',e=>{const input=document.querySelector('#login-password'),show=input.type==='password';input.type=show?'text':'password';e.currentTarget.textContent=show?'隐藏密码':'显示密码';e.currentTarget.setAttribute('aria-pressed',String(show))});
  document.querySelector('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();error.textContent='';
    if(!verified){error.textContent='请先将滑块拖到最右侧，完成验证';slider.focus();return;}
    try{await PayTraceAuth.login(document.querySelector('#login-username').value.trim(),document.querySelector('#login-password').value);location.replace('./index.html')}
    catch(e){error.textContent=e.message;reset();document.querySelector('#login-password').value='';document.querySelector('#login-password').focus()}
  });
  window.addEventListener('pageshow',()=>{if(PayTraceAuth.signedIn())location.replace('./index.html')});
})();
