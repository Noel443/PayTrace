/* Shared attachment limits and validation for browser previews and server requests. */
(() => {
  const maxCount=10,maxBytes=500000;
  function validate(value=[]){
    if(!Array.isArray(value)||value.length>maxCount)throw Error(`最多添加 ${maxCount} 张截图`);
    return value.map((item,index)=>{
      if(!item||typeof item.dataUrl!=='string'||item.dataUrl.length>Math.ceil(maxBytes/3)*4+40)throw Error('截图过大，每张压缩后最多 500 KB');
      const match=item.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if(!match||match[2].length%4)throw Error('截图格式无效，仅支持 PNG、JPEG、WebP');
      let bytes;try{bytes=atob(match[2])}catch{throw Error('截图编码无效')}
      if(bytes.length>maxBytes||btoa(bytes)!==match[2])throw Error('截图编码无效或超过 500 KB');
      const valid=match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';
      if(!valid)throw Error('截图内容与图片类型不符');
      return {name:typeof item.name==='string'?item.name.slice(0,100):`截图 ${index+1}`,dataUrl:item.dataUrl};
    });
  }
  function content(text,images){
    const checked=validate(images);
    return checked.length?[{type:'text',text},...checked.map(item=>({type:'image_url',image_url:{url:item.dataUrl}}))]:text;
  }
  globalThis.PayTraceImages={validate,content,maxCount,maxBytes};
})();
