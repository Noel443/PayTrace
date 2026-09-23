// Only locally defined codes/messages reach the UI; never forward raw network diagnostics.
const transient=new Set(['ECONNRESET','EPIPE','ERR_STREAM_PREMATURE_CLOSE','UND_ERR_SOCKET','ABORT_ERR']);
export function modelReadError(error,received=0){
  const raw=error?.cause?.code||error?.code;
  const code=transient.has(raw)?raw:['Z_DATA_ERROR','Z_BUF_ERROR','ERR_INVALID_STATE'].includes(raw)?raw:error?.name==='TypeError'?'MODEL_STREAM_INTERRUPTED':null;
  if(!code)return error;
  const retryable=transient.has(code)||code==='MODEL_STREAM_INTERRUPTED';
  const reason=retryable?'模型响应连接中断，未收到完整结束标记':['Z_DATA_ERROR','Z_BUF_ERROR'].includes(code)?'模型响应解压失败，收到的数据不完整或损坏':'模型响应流状态异常';
  return Object.assign(Error(reason+'（'+code+'，已接收 '+received+' 字）；未完成内容不会保存'),{code,publicError:true,retryable});
}
export function incompleteModelResponse(received){
  return Object.assign(Error('模型连接提前结束，未收到完整结束标记（已接收 '+received+' 字），分析未完成'),{code:'MODEL_STREAM_INCOMPLETE',publicError:true,retryable:true});
}
