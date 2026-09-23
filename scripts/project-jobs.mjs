import {randomUUID} from 'node:crypto';
export const runningTask=t=>t&&['running','saving'].includes(t.status);
// All project mutations and final commits share one queue. Cancellation wins if
// queued before the final commit; after committing, success is authoritative.
export function projectJobs({getStore,saveStore,analyze,limit=2}){
  let queue=Promise.resolve();const live=new Map();
  const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
  const update=async(id,fn)=>{const store=getStore();const next={...store,projects:store.projects.map(p=>p.id===id?fn(p):p)};await saveStore(next)};
  const find=(id,workspace)=>{const p=getStore().projects.find(p=>p.id===id&&p.workspace===workspace);if(!p)throw Error('当前空间未找到该项目');return p};
  async function recover(){await serial(async()=>{const store=getStore();if(store.projects.some(p=>runningTask(p.task)))await saveStore({...store,projects:store.projects.map(p=>runningTask(p.task)?{...p,task:{...p.task,status:'interrupted',message:'服务重启，生成已中断，请重试',finishedAt:new Date().toISOString()}}:p)})})}
  async function start(id,workspace,config,markdown,totalSeconds=1800){
    if(!Number.isInteger(totalSeconds)||totalSeconds<30||totalSeconds>3600)throw Error('项目总时限须为 30–3600 秒');
    return serial(async()=>{
      const project=find(id,workspace);if(runningTask(project.task))return project.task;
      if(live.has(id))throw Error('上一次任务正在停止，请稍后重试');
      if(live.size>=limit)throw Error('已有两个项目任务运行，请稍后重试');
      const task={id:randomUUID(),status:'running',startedAt:new Date().toISOString(),received:0,stages:[],totalSeconds,message:'任务已创建'};
      await update(id,p=>({...p,task:structuredClone(task)}));
      const controller=new AbortController();live.set(id,controller);
      const timer=setTimeout(()=>controller.abort(Error('项目任务超过总时限')),totalSeconds*1000);
      const emit=(event,data)=>{if(event==='delta')task.received+=data.text.length;if(event==='stage'){task.phase=data.phase;task.stages.push(data.message);task.stages=task.stages.slice(-100);task.message=data.message}};
      // Progress is checkpointed, never persist the model's partial answer.
      const checkpoint=setInterval(()=>{serial(async()=>{if(runningTask(find(id,workspace).task))await update(id,p=>({...p,task:structuredClone(task)}))}).catch(()=>controller.abort(Error('任务进度保存失败')))},1000);
      Promise.resolve().then(()=>analyze(project,{...config,projectTimeoutSeconds:totalSeconds},markdown,emit,{signal:controller.signal})).then(analysis=>serial(async()=>{
        controller.signal.throwIfAborted();
        if(find(id,workspace).revision!==project.revision)throw Error('项目配置已变化，请重新分析');
        emit('stage',{phase:'saving',message:'业务链路校验通过，正在保存'});
        await update(id,p=>({...p,analysis,analysisStale:false,task:{...task,status:'completed',message:'业务链路已保存',finishedAt:new Date().toISOString()}}));
      })).catch(error=>serial(async()=>{
        if(find(id,workspace).task.status==='completed')return;
        await update(id,p=>({...p,task:{...task,status:controller.signal.reason?.message==='用户已停止分析'?'cancelled':'failed',message:controller.signal.reason?.message|| (error.publicError?error.message:error.code?(task.phase==='saving'?'分析完成，但保存失败，旧结果保留':'项目处理发生内部错误，旧结果保留'):error.message),errorCode:error.publicError?error.code:error.code?'INTERNAL_ERROR':undefined,finishedAt:new Date().toISOString()}}));
      })).catch(()=>{}).finally(()=>{clearTimeout(timer);clearInterval(checkpoint);live.delete(id)});
      return {...task};
    });
  }
  const cancel=(id,workspace,taskId)=>serial(async()=>{const p=find(id,workspace);if(p.task?.id!==taskId)throw Error('任务已更新，请刷新');if(runningTask(p.task)){live.get(id)?.abort(Error('用户已停止分析'));await update(id,p=>({...p,task:{...p.task,status:'cancelled',message:'用户已停止分析',finishedAt:new Date().toISOString()}}))}return find(id,workspace).task});
  return {start,cancel,recover,serial,busy:()=>live.size>0};
}
