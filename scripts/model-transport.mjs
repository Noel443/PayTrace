import http from 'node:http';
import https from 'node:https';
import {Readable,pipeline} from 'node:stream';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';

// Fetch resolves at response headers, not at socket connection. Expose the
// actual TCP/TLS boundary so model preparation is not charged to connect time.
export function modelFetch(address,{method='POST',headers={},body,signal,onConnected=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const url=new URL(address);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password){reject(Error('模型接口地址无效'));return}
    const request=(url.protocol==='https:'?https:http).request(url,{
      method,signal,headers:{'Accept-Encoding':'identity',...headers,...(body!==undefined?{'Content-Length':Buffer.byteLength(body)}:{})}
    });
    request.once('error',reject);
    request.once('socket',socket=>{
      if(request.reusedSocket)onConnected();
      else socket.once(url.protocol==='https:'?'secureConnect':'connect',onConnected);
    });
    request.once('response',incoming=>{
      if(incoming.statusCode>=300&&incoming.statusCode<400){
        incoming.destroy();reject(Error('模型接口返回重定向，请填写最终接口地址'));return;
      }
      const responseHeaders=new Headers();
      for(const [name,value] of Object.entries(incoming.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
      const encoding=incoming.headers['content-encoding'];
      const decoder=encoding==='gzip'?createGunzip():encoding==='deflate'?createInflate():encoding==='br'?createBrotliDecompress():null;
      if(encoding&&encoding!=='identity'&&!decoder){incoming.destroy();reject(Error('模型响应压缩格式不支持'));return}
      let stream=incoming;
      if(decoder){pipeline(incoming,decoder,()=>{});stream=decoder;responseHeaders.delete('content-encoding');responseHeaders.delete('content-length')}
      const noBody=[204,205,304].includes(incoming.statusCode);
      if(noBody)incoming.resume();
      resolve(new Response(noBody?null:Readable.toWeb(stream,{strategy:{highWaterMark:65536,size:chunk=>chunk.byteLength}}),{status:incoming.statusCode,headers:responseHeaders}));
    });
    request.end(body);
  });
}
