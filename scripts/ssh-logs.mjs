import {spawn} from 'node:child_process';
import {mkdir,open} from 'node:fs/promises';
import path from 'node:path';

export function shellQuote(value){return "'"+String(value).replace(/'/g,"'\\''")+"'";}
export function logCommand(source,action,query=''){
  // 展开主目录时仅使用远端 HOME；路径其余部分始终作为字面量引用。
  const homePath=value=>value==='~'?'"$HOME"':value.startsWith('~/')?'"$HOME"/'+shellQuote(value.slice(2)):shellQuote(value);
  if(action==='discover'){
    if(!/^[a-zA-Z0-9_.*?-]+$/.test(source.logPath))throw Error('文件筛选规则无效');
    const directory=homePath(source.logDirectory||'~');
    return `cd -- ${directory} || exit 41; find . -maxdepth 1 -type f -name ${shellQuote(source.logPath)} -print`;
  }
  const logPath=source.logPath;
  const base=source.logDirectory?homePath(source.logDirectory):'"$HOME"';
  const resolved=logPath.startsWith('/')||logPath.startsWith('~/')?homePath(logPath):base+'/'+shellQuote(logPath);
  const file='"$paytrace_log_file"';
  const setup=`paytrace_log_file=${resolved}; `;
  const check=setup+`if [ ! -e ${file} ]; then exit 41; fi; if [ ! -f ${file} ]; then exit 42; fi; if [ ! -r ${file} ]; then exit 43; fi; `;
  if(action==='test')return check+`head -c 1 -- ${file} >/dev/null 2>&1 || exit 43; printf 'PAYTRACE_READABLE\\n'`;
  if(action!=='search')throw Error('不支持的 SSH 操作');
  if(typeof query!=='string'||!query.trim()||query.length>200||/[\r\n\0]/.test(query))throw Error('请输入 1–200 个字符的流水号或关联标识，不能包含换行');
  return check+`LC_ALL=C grep -n -F -m 20 -C 200 -- ${shellQuote(query.trim())} ${file}`;
}
export function sshFailure(code,stderr=''){
  if(/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr))return '服务器主机密钥校验失败；请核实服务器身份后检查本机 data/ssh/known_hosts，系统不会自动覆盖旧密钥';
  if(code===5||/Permission denied|Authentication failed/i.test(stderr))return 'SSH 认证失败，请检查账号、密码及服务器是否允许密码登录';
  if(/Connection refused/i.test(stderr))return '服务器拒绝连接，请检查 SSH 端口和服务是否启动';
  if(/timed out|Operation timed out/i.test(stderr))return '连接超时，请检查 IP、端口、VPN 和防火墙';
  if(/Could not resolve hostname|Name or service not known/i.test(stderr))return '无法解析服务器地址，请检查 IP 或主机名';
  if(/No route to host|Network is unreachable/i.test(stderr))return '无法到达服务器，请检查网络或 VPN';
  if(code===41)return 'SSH 登录成功，但配置的日志文件不存在';
  if(code===42)return 'SSH 登录成功，但日志路径不是普通文件，请填写具体日志文件';
  if(code===43)return 'SSH 登录成功，但当前账号无权读取日志文件';
  return 'SSH 操作失败，请检查服务器配置、日志读取权限和远端 grep/head 命令';
}
export async function runSsh(source,{action='test',query='',knownHostsFile,signal,timeoutMs=30000,maxBytes=262144,spawnProcess=spawn}={}){
  if(!source.enabled)throw Error('该数据源已停用，请先启用');
  if(['0.0.0.0','::','0:0:0:0:0:0:0:0'].includes(source.host))throw Error('请把监听地址 '+source.host+' 改为可访问的实际服务器 IP 或域名');
  const command=logCommand(source,action,query);
  if(signal?.aborted)throw Error('SSH 操作已取消');
  await mkdir(path.dirname(knownHostsFile),{recursive:true,mode:0o700});
  const file=await open(knownHostsFile,'a',0o600);await file.close();
  const args=['-d','3','ssh','-F','/dev/null','-T','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+knownHostsFile,'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','NumberOfPasswordPrompts=1','-o','PreferredAuthentications=password,keyboard-interactive','-o','PubkeyAuthentication=no','-o','LogLevel=ERROR'];
  // A production source may be reached through an SSH bastion. Authentication
  // to the bastion is intentionally delegated to the local SSH agent / control
  // connection; the app never stores or forwards a second password.
  if(source.jumpHost){args.push('-J',`${source.jumpUsername}@${source.jumpHost}:${source.jumpPort}`)}
  args.push('-p',String(source.port),'-l',source.username,'--',source.host,command);
  const started=Date.now();
  return new Promise((resolve,reject)=>{
    let child,finished=false,stdout=[],size=0,stderr='',truncated=false,timer;
    function stop(){if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{child.kill('SIGTERM')}}}
    function end(error,result){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);stop();error?reject(error):resolve(result)}
    function abort(){end(Error('SSH 操作已取消'))}
    const result=()=>({ok:true,action,output:Buffer.concat(stdout).toString('utf8'),truncated,contextLines:200,maxMatches:20,durationMs:Date.now()-started,checkedAt:new Date().toISOString(),message:action==='test'?'SSH 登录成功，日志文件可读取（本次检查完成，连接已关闭）':truncated?'日志已返回，达到 256 KB 上限，结果已截断':'日志查询完成'});
    try{child=spawnProcess('sshpass',args,{stdio:['ignore','pipe','pipe','pipe'],detached:true})}catch{end(Error('无法启动 SSH，请确认本机已安装 ssh 和 sshpass'));return}
    timer=setTimeout(()=>end(Error('SSH 操作超过 '+Math.round(timeoutMs/1000)+' 秒，已停止；请检查网络或缩小日志文件范围')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.on('error',()=>end(Error('无法启动 sshpass；macOS 可运行 brew install sshpass，Linux 安装 sshpass 后重试')));
    child.stdio[3].on('error',()=>{});child.stdio[3].end(source.password+'\n');
    child.stdout.on('data',chunk=>{
      if(finished)return;const remaining=maxBytes-size;stdout.push(chunk.subarray(0,Math.max(0,remaining)));size+=Math.min(chunk.length,remaining);
      if(chunk.length>remaining){if(action==='test'){end(Error('SSH 返回异常，无法确认日志权限'));return;}truncated=true;end(null,result())}
    });
    child.stderr.on('data',chunk=>{if(stderr.length<16384)stderr+=chunk.toString('utf8').slice(0,16384-stderr.length)});
    child.on('close',code=>{
      if(finished)return;
      if(code===0||(action==='search'&&code===1)){
        const data=result();if(action==='test'&&!data.output.includes('PAYTRACE_READABLE')){end(Error('SSH 返回异常，未能确认日志读取权限'));return;}
        if(action==='test')data.output='';else if(code===1)data.message='未找到匹配日志；不代表交易未发生，请核对标识和日志时间范围';
        end(null,data);
      }else end(Error(sshFailure(code,stderr)));
    });
  });
}
