import {isLocalConfigRequest} from './model-config.mjs';

export function parsePublicOrigins(value=''){
  if(!value.trim())return [];
  return [...new Set(value.split(',').map(entry=>{
    const origin=entry.trim();
    let url;try{url=new URL(origin)}catch{throw Error('PUBLIC_ORIGINS 必须是逗号分隔的 HTTP/HTTPS 来源地址');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.hostname.includes('*')||origin!==url.origin)throw Error('PUBLIC_ORIGINS 请填写完整来源地址，不含路径、末尾斜杠或通配符');
    return origin;
  }))];
}

export function requestAccess({port,publicOrigins=[],authenticated=false}){
  if(publicOrigins.length&&!authenticated)throw Error('PUBLIC_ORIGINS 需要 MySQL 模式的服务端登录验证，请先配置数据库');
  const hosts=new Set(publicOrigins.map(origin=>new URL(origin).host));
  function allowed(req){
    if(isLocalConfigRequest(req,port))return true;
    // NATAPP runs on this machine. Only the actual Host is trusted; proxy
    // headers never grant access or replace the configured browser origin.
    return authenticated&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&hosts.has(req.headers.host);
  }
  function sameOrigin(req){
    if(!allowed(req))return false;
    if(isLocalConfigRequest(req,port))return req.headers.origin===`http://${req.headers.host}`;
    return publicOrigins.some(origin=>origin===req.headers.origin&&new URL(origin).host===req.headers.host);
  }
  return {allowed,sameOrigin};
}
