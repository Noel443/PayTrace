import {runServerLogs} from './server-logs.mjs';

export const CONTEXT_GUIDANCE='日志证据中的 matchLines 是关键词命中位置，context 是附近原文（带原始行号），可能包含其他交易。必须结合环境、时间、线程和交易标识判断关联；同线程会复用，不能仅凭相邻或同线程认定同一交易。异常后的无时间戳行可能是堆栈，需结合异常首行阅读。优先解释有证据的具体异常，不要只因异常行没有订单号就忽略。停止扩展只表示取得候选异常或达到读取边界，不证明已找到根因。';
const rows=output=>String(output||'').split('\n').flatMap(line=>{
  const m=line.match(/^(\d+)([:-])(.*)$/);return m?[{line:Number(m[1]),text:m[3],match:m[2]===':'}]:[];
});
const stamp=text=>text.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?)\s+\[([^\]]+)\]/);
function hasCandidate(entries,query){
  const anchors=entries.filter(r=>r.match&&r.text.includes(query)).map(r=>stamp(r.text)).filter(Boolean);
  return entries.some(r=>{
    if(!/\b(?:ERROR|Exception)\b/.test(r.text))return false;
    const event=stamp(r.text);return event&&anchors.some(a=>a[2]===event[2]&&Math.abs(Date.parse(a[1])-Date.parse(event[1]))<=5000);
  });
}

// Always locate the literal marker across all configured sources before widening hit files.
export async function collectLogEvidence(sources,query,emit,{signal,knownHostsFile,search=runServerLogs,forceExpand=false,idPrefix='E'}={}){
  if(typeof query!=='string'||!query.trim()||query.length>200||/[\r\n\0]/.test(query))throw Error('日志检索标识无效');
  const files=[],coverage=[],evidence=[];let remaining=45000;
  for(const source of sources){
    signal?.throwIfAborted();emit('stage',{message:'正在定位日志：'+source.name});
    try{
      const result=await search(source,{action:'search',query,contextLines:0,knownHostsFile,signal});
      signal?.throwIfAborted();
      for(const file of result.files||[{...result,logPath:source.logPath,service:source.service}]){
        const entry={source:source.name,environment:source.environment,file:file.logPath,service:file.service,status:file.error?'failed':'queried',matches:rows(file.output).filter(r=>r.match&&r.text.includes(query)).length,omitted:0,truncated:!!file.truncated,limited:true,contextLines:0,attempts:[0],message:file.error||file.message};
        coverage.push(entry);if(!file.error&&entry.matches)files.push({source,file,entry});
      }
    }catch(e){signal?.throwIfAborted();coverage.push({source:source.name,environment:source.environment,status:'failed',message:e.message});}
  }
  for(const {source,file,entry} of files){
    let output=file.output;
    for(const radius of [100,200,500,1000]){
      signal?.throwIfAborted();
      if(remaining<=0||evidence.length>=100){entry.stopReason='证据容量上限';break;}
      emit('stage',{message:`正在读取 ${source.name} / ${file.logPath} 前后各 ${radius} 行`});
      entry.attempts.push(radius);
      try{
        // File path comes only from this request's configured source/discovery, never a report or model.
        const scoped={...source,logPath:file.logPath,service:file.service};
        if(source.logs)scoped.logs=[{logPath:file.logPath,service:file.service}];
        const result=await search(scoped,{action:'search',query,contextLines:radius,knownHostsFile,signal});
        signal?.throwIfAborted();
        const next=result.files?result.files.find(f=>f.logPath===file.logPath):result;
        if(!next||next.error)throw Error(next?.error||'命中文件未返回上下文');
        entry.truncated ||= !!next.truncated;
        const entries=rows(next.output);
        if(!entries.some(r=>r.match&&r.text.includes(query))){entry.stopReason=next.truncated?'远端输出在命中位置之前截断':'重新读取未命中，文件可能已轮转';break;}
        const unchanged=next.output===output;
        output=next.output;entry.contextLines=radius;entry.truncated ||= !!next.truncated;
        if(next.truncated){entry.stopReason='远端输出截断';break;}
        if(!forceExpand&&hasCandidate(entries,query)){entry.stopReason='取得同时间、同线程候选异常，交由模型核实';break;}
        // Only rely on metadata supplied by the real reader (also supports older custom readers).
        if(unchanged&&next.contextLines===radius){entry.stopReason='扩大后无新增日志';break;}
        if(radius===1000)entry.stopReason='已达到前后各 1000 行上限';
      }catch(e){signal?.throwIfAborted();entry.contextError=e.message;entry.stopReason='上下文读取失败';break;}
    }
    const entries=rows(output),matches=entries.filter(r=>r.match&&r.text.includes(query));
    // Keep match evidence distinct from contextual candidates; preserve multiline stacks in a block.
    const seen=new Set(),omitted=new Set();
    for(const match of matches){
      if(seen.has(match.line))continue;
      if(evidence.length>=100||match.text.length>remaining){omitted.add(match.line);continue;}
      const block=entries.filter(r=>Math.abs(r.line-match.line)<=entry.contextLines&&!seen.has(r.line));
      // Favor the anchor and immediately following exception over distant, noisy preceding traffic.
      const anchor=stamp(match.text),important=new Set();
      let inStack=false;
      for(const row of block){
        if(/^\d{4}-\d{2}-\d{2}[ T]/.test(row.text)){
          const event=stamp(row.text);
          inStack=!!(anchor&&event&&anchor[2]===event[2]&&Math.abs(Date.parse(anchor[1])-Date.parse(event[1]))<=5000&&/\b(?:ERROR|Exception)\b/.test(row.text));
        }
        if(inStack)important.add(row.line);
      }
      const rank=row=>row.line===match.line?0:important.has(row.line)?1:2;
      const ordered=[...block].sort((a,b)=>rank(a)-rank(b)||Math.abs(a.line-match.line)-Math.abs(b.line-match.line)||b.line-a.line);
      let budget=Math.min(remaining-match.text.length,14000),kept=[];
      for(const row of ordered){
        const cost=row.text.length+String(row.line).length+30;
        if(cost>budget){omitted.add(row.line);continue;}
        budget-=cost;kept.push(row);seen.add(row.line);omitted.delete(row.line);
      }
      kept.sort((a,b)=>a.line-b.line);
      const context=kept.map((r,i)=>(i&&r.line>kept[i-1].line+1?'[中间日志未纳入]\n':'')+r.line+': '+r.text).join('\n');
      remaining-=match.text.length+context.length;
      evidence.push({id:idPrefix+(evidence.length+1),service:file.service,source:source.name,environment:source.environment,file:file.logPath,line:match.line,text:match.text,matchedBy:query,matchLines:[...new Set([match.line,...kept.filter(r=>r.match&&r.text.includes(query)).map(r=>r.line)])],context,contextLines:entry.contextLines});
    }
    entry.omitted=omitted.size;
    entry.truncated ||= entry.omitted>0;
  }
  return {evidence,coverage};
}
