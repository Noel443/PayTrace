import {runSsh} from './ssh-logs.mjs';

// One saved server connection, multiple file rules; old single-file sources stay compatible.
export async function runServerLogs(source,options={},execute=runSsh){
  if(!source.logs)return execute(source,options);
  const started=Date.now(),files=[],seen=new Set();
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  const opts={...options,signal};
  for(const rule of source.logs){
    signal.throwIfAborted();
    let paths=[rule.logPath];
    try{
      if(/[?*]/.test(rule.logPath)){
        const result=await execute({...source,logPath:rule.logPath},{...opts,action:'discover'});
        if(result.truncated)throw Error('匹配文件列表过大，请缩小筛选范围');
        paths=result.output.split('\n').filter(Boolean).map(p=>p.replace(/^\.\//,''));
        if(paths.some(p=>!p||p.includes('/')||/[\r\0]/.test(p)))throw Error('日志文件名格式不支持，请改用具体文件');
        if(!paths.length)throw Error('没有找到符合规则的日志文件');
      }
      for(const logPath of paths){
        signal.throwIfAborted();if(seen.has(logPath))continue;
        if(seen.size>=20)throw Error('每台服务器最多查询 20 个文件，请缩小规则范围');
        seen.add(logPath);
        const service=rule.service||logPath.split('/').pop().replace(/(?:-console|-error)?\.log$/,'');
        try{const result=await execute({...source,logPath,service},{...opts});files.push({...result,logPath,service});}
        catch(e){signal.throwIfAborted();files.push({logPath,service,error:e.message,output:''});}
      }
    }catch(e){signal.throwIfAborted();files.push({logPath:rule.logPath,service:rule.service||'auto',error:e.message,output:''});}
  }
  const failed=files.filter(f=>f.error).length;
  return {ok:failed===0,files,output:files.map(f=>`=== ${f.service} / ${f.logPath} ===\n${f.error?'查询失败：'+f.error:f.output}`).join('\n'),truncated:files.some(f=>f.truncated),durationMs:Date.now()-started,checkedAt:new Date().toISOString(),message:`检查 ${files.length} 个日志文件，${failed} 个失败`};
}
