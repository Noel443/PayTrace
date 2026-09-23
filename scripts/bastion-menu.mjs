import {StringDecoder} from 'node:string_decoder';
import {randomBytes} from 'node:crypto';

// Only send the fixed asset-selection command, then a fixed read-only command.
// Framing tokens are split in the command so terminal echo cannot impersonate output.
export function menuSession(source,command,{write,complete,fail,stage=()=>{},maxBytes=262144}){
  const token=randomBytes(16).toString('hex'),begin=`PT_BEGIN_${token}`,end=`PT_END_${token}`;
  const decoder=new StringDecoder('utf8');
  let state='menu',buffer='',output='';
  const clean=value=>value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r/g,'');
  const enterMenu=()=>{
    if(state!=='menu')return;
    state='command';buffer='';stage('进入堡垒机交互界面，按冒号');
    // Behave like Termius: type the SSH command directly in the usmshell PTY.
    write(':');
  };
  const enterTarget=()=>{if(state!=='shell')return;state='begin';buffer='';stage('收到目标 Shell 提示符');stage('发送日志检查命令');write(`printf '\\n%s%s\\n' 'PT_BEGIN_' '${token}'; ( ${command} ); paytrace_status=$?; printf '\\n%s%s:%s\\n' 'PT_END_' '${token}' "$paytrace_status"\n`)};
  return chunk=>{
    if(state==='done')return;
    buffer+=clean(decoder.write(Buffer.from(chunk)));
    if(/\[USM\][^\n]*unavailable/i.test(buffer)){state='done';fail(Error('堡垒机返回 USM unavailable，目标会话未建立；'+buffer.slice(-500)));return;}
    if(state==='menu'){
      // The menu itself is only a terminal prompt. Do not select rows or
      // infer an asset number; Termius sends the SSH command directly.
      if(/\[usmshell\]/i.test(buffer)){stage('收到 usmshell 菜单');enterMenu();}
      if(buffer.length>65536)buffer=buffer.slice(-65536);
      return;
    }
    if(state==='command'){
      if(/:\s*$/.test(buffer)){state='shell';buffer='';stage('命令行已就绪，发送目标 SSH 命令');write(`ssh ${source.username}@${source.host}:${source.port}\r`);}
      return;
    }
    if(state==='shell'){

      if(/(?:password|passphrase|verification code|验证码)\s*[:：]\s*$/i.test(buffer)){
        state='done';fail(Error('目标资产要求二次认证，当前菜单模式仅支持堡垒机托管账号自动登录'));return;
      }
      if(!/(?:^|\n)[^\n]{0,200}[$#] ?$/.test(buffer)){
        if(buffer.length>32768)buffer=buffer.slice(-32768);
        return;
      }
      enterTarget();
      return;
    }
    if(state==='begin'){
      const start=buffer.indexOf('\n'+begin+'\n');
      if(start<0){if(buffer.length>32768)buffer=buffer.slice(-32768);return;}
      buffer=buffer.slice(start+begin.length+2);state='output';
    }
    if(state==='output'){
      const match=buffer.match(new RegExp('\\n'+end+':(\\d+)\\n'));
      if(match){
        output+=buffer.slice(0,match.index);state='done';
        const bytes=Buffer.from(output);complete(Number(match[1]),bytes.subarray(0,maxBytes),bytes.length>maxBytes);return;
      }
      // Keep a small tail for completion tokens split across network packets.
      const keep=end.length+32;
      if(buffer.length>keep){output+=buffer.slice(0,-keep);buffer=buffer.slice(-keep);}
      if(Buffer.byteLength(output)>maxBytes){state='done';complete(0,Buffer.from(output).subarray(0,maxBytes),true);}
    }
  };
}
