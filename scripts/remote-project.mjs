import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

export function remoteUrl(value){
  let url;try{url=new URL(value)}catch{throw Error('请填写完整的 HTTP / HTTPS Git 仓库地址')}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.pathname==='/')throw Error('请填写 HTTP / HTTPS Git 仓库地址，例如 https://git.example.com/team/project.git');
  if(url.username||url.password||url.search||url.hash)throw Error('仓库地址不能包含账号密码、Token、查询参数或片段；私有仓库请使用本机 Git 凭据');
  return url.href;
}

// Clone only into a task-owned temporary directory; never fetch into a user's working copy.
export async function withRemoteProject(project,readSnapshot,{signal,emit=()=>{},runner=exec}={}){
  const url=remoteUrl(project.remoteUrl);
  const dir=await mkdtemp(path.join(tmpdir(),'paytrace-remote-')),repo=path.join(dir,'repository');
  try{
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
    const cloneSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
    emit('stage',{phase:'fetching',message:'正在获取远程仓库 '+project.branch+' 分支，最长约 60 秒'});
    try{
      await runner('git',['-c','http.followRedirects=initial','clone','--depth','1','--single-branch','--no-checkout','--no-tags','--branch',project.branch,'--',url,repo],{
        encoding:'utf8',timeout:60000,maxBuffer:256000,signal:cloneSignal,
        env:{...env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'false',GCM_INTERACTIVE:'never',GIT_ALLOW_PROTOCOL:'http:https'}
      });
    }catch(e){
      if(signal?.aborted)throw Error('分析已停止');
      if(cloneSignal.aborted||e.killed)throw Error('远程仓库获取超过 60 秒，请检查网络或改用本地仓库');
      if(e.code==='ENOENT')throw Error('本机未找到 git，请安装 Git 后重试');
      const detail=String(e.stderr||'');
      if(/authentication|could not read Username|could not read Password|403|401|terminal prompts disabled/i.test(detail))throw Error('远程仓库认证失败，请先在本机 Git 凭据管理器配置账号 / Token，或克隆到本地后使用本地仓库模式');
      if(/Remote branch .* not found|couldn't find remote ref/i.test(detail))throw Error('远程仓库没有指定分支：'+project.branch+'，请确认使用 master、main 或实际分支名');
      throw Error('远程仓库获取失败，请检查仓库克隆地址、分支、网络 / VPN 和 Git 访问权限');
    }
    signal?.throwIfAborted();
    return await readSnapshot(repo);
  }finally{await rm(dir,{recursive:true,force:true})}
}
