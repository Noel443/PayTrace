/* 工作空间目录；真实数据源与项目在服务配置中管理。 */
window.workspaceCatalog = [
  {
    "id": "card",
    "name": "外卡支付",
    "repository": "",
    "commit": "",
    "description": "支付受理、渠道结果与商户通知",
    "businesses": [
      "外卡收单",
      "异步通知",
      "支付结果核实"
    ],
    "services": [],
    "cases": [],
    "flow": []
  },
  {
    "id": "cross-border",
    "name": "跨境支付",
    "repository": "",
    "commit": "",
    "description": "跨境汇款、银行明细推送与海关申报",
    "businesses": [
      "跨境汇款",
      "银行明细推送",
      "海关申报"
    ],
    "services": [],
    "cases": [],
    "flow": []
  },
  {
    "id": "hk-cb",
    "name": "MSO",
    "repository": "",
    "commit": "",
    "description": "外币付款、收款人报备与虚拟账户",
    "businesses": [
      "外币付款",
      "境外收款人",
      "虚拟账户"
    ],
    "services": [],
    "cases": [],
    "flow": []
  }
];

window.workspaceData = {
  get(id='card') {
    const w=window.workspaceCatalog.find(w=>w.id===id);
    if(!w)throw Error('工作空间不存在');
    return w;
  },
  create(input) {
    const name=String(input.name||'').trim(),description=String(input.description||'').trim();
    const businesses=String(input.businesses||'').split(/[,，、\n]/).map(s=>s.trim()).filter(Boolean);
    if(!name||name.length>40||description.length>300||businesses.length>12||businesses.some(b=>b.length>40))throw Error('请检查空间名称、业务说明和业务线长度');
    if(window.workspaceCatalog.some(w=>w.name.toLowerCase()===name.toLowerCase()))throw Error('工作空间名称已存在');
    const existing=window.workspaceCatalog.filter(w=>w.custom);
    if(existing.length>=30)throw Error('最多创建 30 个自定义工作空间');
    const id='ws-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    const w={id,name,description:description||'待配置日志数据源与业务知识',businesses:businesses.length?businesses:['通用业务'],custom:true,repository:'',commit:'',services:[],cases:[],flow:[]};
    try{localStorage.setItem('paytrace.custom-workspaces.v1',JSON.stringify([...existing,w]))}catch{throw Error('工作空间未保存，请检查浏览器存储后重试')}
    window.workspaceCatalog.push(w);return w;
  },
  update(id,input) {
    const current=this.get(id),name=String(input.name||'').trim(),description=String(input.description||'').trim();
    const businesses=String(input.businesses||'').split(/[,，、\n]/).map(s=>s.trim()).filter(Boolean);
    if(!name||name.length>40||description.length>300||businesses.length>12||businesses.some(b=>b.length>40))throw Error('请检查空间名称、业务说明和业务线长度');
    if(window.workspaceCatalog.some(w=>w.id!==id&&w.name.toLowerCase()===name.toLowerCase()))throw Error('工作空间名称已存在');
    const meta=JSON.parse(localStorage.getItem('paytrace.workspace-meta.v1')||'{}');
    meta[id]={name,description,businesses};
    try{localStorage.setItem('paytrace.workspace-meta.v1',JSON.stringify(meta))}catch{throw Error('工作空间未保存，请检查浏览器存储后重试')}
    Object.assign(current,meta[id]);return current;
  },
  remove(id) {
    this.get(id);if(window.workspaceCatalog.length<=1)throw Error('至少保留一个工作空间，请先新建空间');
    const meta=JSON.parse(localStorage.getItem('paytrace.workspace-meta.v1')||'{}');meta[id]={deleted:true};
    const prefix='paytrace.frontend.v1.'+(id==='card'?'':id+'.');
    const changes=new Map(['reports','services','knowledge'].map(k=>[prefix+k,null]));
    changes.set('paytrace.custom-workspaces.v1',JSON.stringify(window.workspaceCatalog.filter(w=>w.custom&&w.id!==id)));
    changes.set('paytrace.workspace-meta.v1',JSON.stringify(meta));
    const previous=new Map([...changes.keys()].map(k=>[k,localStorage.getItem(k)]));
    try{for(const [k,v] of changes)v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}
    catch{for(const [k,v] of previous){try{v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}}throw Error('浏览器空间清理未完成，请刷新核对后重试')}
    window.workspaceCatalog=window.workspaceCatalog.filter(w=>w.id!==id);
  },
  services(id) {
    this.get(id);
    return [];
  },
  knowledge(id) {
    this.get(id);
    return {scanEnabled:false,projects:[],updatedAt:null,markdown:''};
  }

};

// Load custom spaces without altering built-in IDs or existing storage namespaces.
try{
  const saved=JSON.parse(localStorage.getItem('paytrace.custom-workspaces.v1')||'[]');
  if(Array.isArray(saved))for(const w of saved){
    if(!w||!/^ws-[a-z0-9-]+$/.test(w.id)||typeof w.name!=='string'||!w.name.trim()||window.workspaceCatalog.some(x=>x.id===w.id))continue;
    window.workspaceCatalog.push({id:w.id,name:w.name.slice(0,40),description:String(w.description||'').slice(0,300),businesses:Array.isArray(w.businesses)?w.businesses.filter(b=>typeof b==='string').slice(0,12).map(b=>b.slice(0,40)):[],custom:true,repository:'',commit:'',services:[],cases:[],flow:[]});
  }
}catch{}

// Built-in spaces can also be renamed or removed; preserve existing storage namespaces.
try{
  const meta=JSON.parse(localStorage.getItem('paytrace.workspace-meta.v1')||'{}');
  const visible=window.workspaceCatalog.filter(w=>!meta[w.id]?.deleted);
  if(visible.length)window.workspaceCatalog=visible;
  for(const w of window.workspaceCatalog){const m=meta[w.id];if(m&&typeof m.name==='string'&&m.name.trim())Object.assign(w,{name:m.name.slice(0,40),description:String(m.description||'').slice(0,300),businesses:Array.isArray(m.businesses)?m.businesses.filter(b=>typeof b==='string').slice(0,12):w.businesses})}
}catch{}
