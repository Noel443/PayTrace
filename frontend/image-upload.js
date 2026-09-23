(() => {
  const picker=document.querySelector('#question-images'),previews=document.querySelector('#question-image-previews'),status=document.querySelector('#question-image-status');
  const composer=document.querySelector('#question-composer'),addButton=document.querySelector('#add-question-images'),question=document.querySelector('#question');
  let images=[],version=0,loading=false;
  function syncControls(){addButton.disabled=loading||busy||images.length>=PayTraceImages.maxCount;previews.querySelectorAll('button').forEach(button=>button.disabled=loading||busy);composer.setAttribute('aria-busy',String(loading));question.required=!images.length;}
  function render(){
    status.textContent=images.length?`已添加 ${images.length} / ${PayTraceImages.maxCount} 张截图，将发送给当前模型。`:'';
    previews.replaceChildren();
    images.forEach((item,index)=>{
      const card=document.createElement('div');card.className='screenshot-card';
      const img=document.createElement('img');img.src=item.dataUrl;img.alt=item.name;
      const remove=document.createElement('button');remove.type='button';remove.className='screenshot-remove';remove.textContent='×';remove.title='移除截图 '+item.name;remove.setAttribute('aria-label','移除截图 '+item.name);
      remove.onclick=()=>{if(loading||busy)return;images.splice(index,1);render()};card.append(img,remove);previews.append(card);
    });
    syncControls();
  }
  async function prepare(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPEG 或 WebP 图片');
    if(file.size>10000000)throw Error('原图不能超过 10 MB');
    const url=URL.createObjectURL(file),img=new Image();
    try{
      img.src=url;await img.decode();
      if(img.naturalWidth*img.naturalHeight>40000000)throw Error('图片分辨率过大，请裁剪后上传');
      const canvas=document.createElement('canvas'),scale=Math.min(1,2000/Math.max(img.naturalWidth,img.naturalHeight));
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      let dataUrl=canvas.toDataURL('image/png');
      if(dataUrl.length>666690)for(const quality of [.9,.8,.65,.5]){dataUrl=canvas.toDataURL('image/jpeg',quality);if(dataUrl.length<=666690)break;}
      return PayTraceImages.validate([{name:file.name||'粘贴的截图',dataUrl}])[0];
    }finally{URL.revokeObjectURL(url)}
  }
  async function add(files){
    if(loading||busy)return;
    if(!files.length)return;
    if(images.length+files.length>PayTraceImages.maxCount){status.textContent=`最多添加 ${PayTraceImages.maxCount} 张截图，还可添加 ${PayTraceImages.maxCount-images.length} 张`;picker.value='';return;}
    const revision=version;loading=true;syncControls();status.textContent='正在处理截图…';
    try{const next=[];for(const file of files)next.push(await prepare(file));if(revision!==version)return;images.push(...next);render();}
    catch(e){if(revision===version)status.textContent=e.message}
    finally{loading=false;picker.value='';syncControls()}
  }
  addButton.addEventListener('click',()=>{if(!loading&&!busy)picker.click()});
  let dragDepth=0;
  composer.addEventListener('dragenter',event=>{if(![...event.dataTransfer.types].includes('Files'))return;event.preventDefault();dragDepth++;composer.classList.add('is-dragging')});
  composer.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=loading||busy?'none':'copy'}});
  composer.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;composer.classList.remove('is-dragging')}});
  composer.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;composer.classList.remove('is-dragging');add([...event.dataTransfer.files])});
  new MutationObserver(syncControls).observe(document.querySelector('#run'),{attributes:true,attributeFilter:['disabled']});
  render();
  picker.addEventListener('change',()=>add([...picker.files]));
  document.querySelector('#investigate-form').addEventListener('paste',event=>{
    const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
    if(files.length){event.preventDefault();add(files)}
  });
  window.questionImages={get(){if(loading)throw Error('截图正在处理，请稍后提交');return PayTraceImages.validate(images)},set(value=[]){version++;images=PayTraceImages.validate(value);status.textContent='';render()}};
  window.addEventListener('paytrace:logout',()=>window.questionImages.set());
})();
