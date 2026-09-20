/* Shared UTF-8 event reader for provider SSE / Ollama NDJSON and browser SSE. */
(() => {
  async function readEvents(response,format,onEvent){
    if(!response.body)throw Error('模型服务未返回可读取的内容');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',data=[],event='message',total=0,stopped=false;
    async function dispatch(){
      if(!data.length){event='message';return;}
      const value=data.join('\n'),kind=event;data=[];event='message';
      if(await onEvent({event:kind,data:value})===false)stopped=true;
    }
    async function line(value){
      if(format==='ndjson'){if(value.trim()&&await onEvent({event:'message',data:value})===false)stopped=true;return;}
      if(!value){await dispatch();return;}
      if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));
      else if(value.startsWith('event:'))event=value.slice(6).trim();
      if(data.reduce((n,s)=>n+s.length,0)>131072)throw Error('模型事件内容过大');
    }
    try{
      while(!stopped){
        const {done,value}=await reader.read();
        total+=value?.byteLength||0;if(total>2000000)throw Error('模型响应过大');
        buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n'))!==-1&&!stopped){const current=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);await line(current);}
        if(buffer.length>131072)throw Error('模型响应行过长');
        if(done){if(buffer&&!stopped)await line(buffer.replace(/\r$/,''));if(!stopped&&format!=='ndjson')await dispatch();break;}
      }
    }finally{try{await reader.cancel()}catch{}reader.releaseLock();}
  }
  globalThis.PayTraceStream={readEvents};
})();
