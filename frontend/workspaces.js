/* master 分支静态审阅摘要。交易和日志为按业务规则构造的沙箱数据，不是仓库实际运行记录。 */
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
    "services": [
      {
        "name": "trx",
        "role": "同步交易处理"
      },
      {
        "name": "daemon",
        "role": "异步商户通知"
      }
    ],
    "cases": [],
    "flow": [
      "交易受理",
      "trx · 交易处理",
      "支付渠道",
      "daemon · 通知",
      "商户系统"
    ]
  },
  {
    "id": "cross-border",
    "name": "跨境支付",
    "repository": "cross-border",
    "commit": "32fb39352d48da0e5f76137c94e492f8a38c2083",
    "description": "跨境汇款、银行明细推送与海关申报",
    "businesses": [
      "跨境汇款",
      "银行明细推送",
      "海关申报"
    ],
    "services": [
      {
        "name": "cb_trx",
        "role": "交易接入与业务调用"
      },
      {
        "name": "cb_daemon",
        "role": "异步任务与渠道查询"
      }
    ],
    "cases": [
      {
        "id": "CB202609200001",
        "business": "跨境汇款",
        "scenario": "收款人协议过期，汇款未受理",
        "question": "为什么汇款提交后没有渠道处理记录？",
        "status": "受理未通过",
        "statusLabel": "受理未通过",
        "amount": "12500.00",
        "currency": "USD",
        "pipeline": [
          {
            "label": "汇款申请",
            "service": "cb_trx",
            "detail": "/rest/docking/rmbCross"
          },
          {
            "label": "协议有效期校验",
            "service": "cb_trx",
            "detail": "ReceiveInfo.validateReceiveEnd"
          },
          {
            "label": "业务分流",
            "service": "cb_trx",
            "detail": "cb_common：本地或远程跨境核心"
          },
          {
            "label": "汇款处理",
            "service": "cb_trx",
            "detail": "RmbCrossServiceBiz / remoteCrossBorderCoreBusiness"
          }
        ],
        "events": [
          {
            "service": "cb_trx",
            "event": "REMIT_REQUEST",
            "detail": "receiveID=RCV001 orderNo=RM001"
          },
          {
            "service": "cb_trx",
            "event": "AGREEMENT_EXPIRED",
            "detail": "validation=validateReceiveEnd result=REJECTED"
          }
        ],
        "title": "收款人协议校验未通过，尚未进入汇款业务处理",
        "summary": "当前沙箱记录在收款人协议有效期校验处返回。代码中该检查位于 rmbCrossOrderBiz.rmbCross 调用之前，因此本次请求不能据此认定已向渠道发起汇款。",
        "actions": [
          "核对收款人协议有效期及审核状态，更新资料后按业务流程重新提交。",
          "检查是否存在其他请求已受理，避免重复发起同一订单。"
        ],
        "uncertainties": [
          "此处只能确认当前请求被校验拦截，不能确认商户其他提交的结果。"
        ],
        "sources": [
          {
            "file": "cb/cb_trx/src/main/java/com/helipay/app/trx/docking/controller/rmbCross/RmbCrossOrderController.java",
            "line": 86,
            "symbol": "rmbCross",
            "note": "收款人协议过期时直接返回，之后才调用业务层。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/docking/RmbCrossOrderBizImpl.java",
            "line": 162,
            "symbol": "rmbCross",
            "note": "依据 crossBorderSysDeal 分流到本地或远程核心；不是固定单一路径。"
          }
        ],
        "diagnosis": "已定位",
        "merchant": "远航贸易",
        "channel": "业务渠道",
        "channelId": "SBX-CB202609200001",
        "time": "2026-09-20 10:30:00"
      },
      {
        "id": "CB202609200002",
        "business": "银行明细推送",
        "scenario": "明细文件已生成，银行上传失败",
        "question": "文件已经生成了，为什么银行仍未收到明细？",
        "status": "FAIL",
        "statusLabel": "FAIL",
        "amount": "36000.00",
        "currency": "CNY",
        "pipeline": [
          {
            "label": "任务补偿",
            "service": "cb_daemon",
            "detail": "BankDetailPushTaskDealTimer"
          },
          {
            "label": "队列消费",
            "service": "cb_daemon",
            "detail": "QUEUE_CB_BANK_DETAIL_PUSH_TASK"
          },
          {
            "label": "生成文件",
            "service": "cb_daemon",
            "detail": "cb_common：createBankDetailPushFile"
          },
          {
            "label": "银行上传",
            "service": "cb_daemon",
            "detail": "cb_common：uploadBankDetailPushFile"
          }
        ],
        "events": [
          {
            "service": "cb_daemon",
            "event": "TASK_DISPATCH",
            "detail": "taskId=TASK002 mqType=CREATE"
          },
          {
            "service": "cb_daemon",
            "event": "FILE_CREATED",
            "detail": "taskId=TASK002 pushStatus=DOING"
          },
          {
            "service": "cb_daemon",
            "event": "UPLOAD_FAILED",
            "detail": "taskId=TASK002 pushStatus=FAIL result=NON_SUCCESS"
          }
        ],
        "title": "文件生成与银行接收是不同阶段，上传结果为失败",
        "summary": "任务已生成文件并进入 DOING，随后银行上传响应非成功，沙箱记录为 FAIL。源码显示上传响应决定最终 pushStatus，文件生成成功本身不能证明银行已接收。",
        "actions": [
          "使用任务 ID、batchNo、applyOrderNo 关联文件生成和上传记录。",
          "核对银行响应与实际接收结果，检查文件内容和渠道要求。",
          "由授权人员确认后处理失败任务；当前补偿定时任务筛选 INIT、DOING，不应假定 FAIL 会自动补偿。"
        ],
        "uncertainties": [
          "银行失败响应的具体业务含义仍需渠道文档或支持人员确认。"
        ],
        "sources": [
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/controller/job/fund/BankDetailPushTaskDealTimer.java",
            "line": 33,
            "symbol": "execute",
            "note": "筛选 INIT、DOING 状态的任务发送 MQ。"
          },
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/listener/fund/BankDetailPushTaskListener.java",
            "line": 31,
            "symbol": "process",
            "note": "按 CREATE / UPLOAD 分支调用共享业务层。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/bankdetailpush/BankDetailPushBizImpl.java",
            "line": 83,
            "symbol": "createBankDetailPushFile",
            "note": "生成完成且状态 DOING 时发送 UPLOAD 消息。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/bankdetailpush/BankDetailPushBizImpl.java",
            "line": 442,
            "symbol": "uploadBankDetailPushFile",
            "note": "调用渠道 uploadBankDetail，根据返回码更新 FAIL 或 SUCCESS。"
          }
        ],
        "diagnosis": "已定位",
        "merchant": "远航贸易",
        "channel": "业务渠道",
        "channelId": "SBX-CB202609200002",
        "time": "2026-09-20 10:30:00"
      },
      {
        "id": "CB202609200003",
        "business": "海关申报",
        "scenario": "申报已发送，回执状态未更新",
        "question": "支付已完成，为什么报关状态还停留在处理中？",
        "status": "DOING",
        "statusLabel": "DOING",
        "amount": "890.00",
        "currency": "CNY",
        "pipeline": [
          {
            "label": "申报请求",
            "service": "cb_trx",
            "detail": "ApplyCustomsController"
          },
          {
            "label": "创建报关单",
            "service": "cb_trx",
            "detail": "cb_common：applyCustomsOrder"
          },
          {
            "label": "定时查单",
            "service": "cb_daemon",
            "detail": "ApplyCustomsOrderQueryTimer"
          },
          {
            "label": "渠道查询",
            "service": "cb_daemon",
            "detail": "cb_common：channelQuery"
          },
          {
            "label": "条件重试",
            "service": "cb_daemon",
            "detail": "autoRetryAfterQuery"
          }
        ],
        "events": [
          {
            "service": "cb_trx",
            "event": "CUSTOMS_ACCEPTED",
            "detail": "applySerialNumber=AP003"
          },
          {
            "service": "cb_daemon",
            "event": "CUSTOMS_QUERY",
            "detail": "applySerialNumber=AP003 channelStatus=DOING"
          },
          {
            "service": "cb_daemon",
            "event": "RETRY_NOT_DUE",
            "detail": "applySerialNumber=AP003 autoRetry=true intervalReached=false"
          }
        ],
        "title": "申报状态尚未变化，自动重试条件未满足",
        "summary": "沙箱查询记录仍为 DOING，且未到自动重试间隔。源码只有在状态一致时检查重试配置及间隔；支付结果和申报结果应分别核实。",
        "actions": [
          "通过申报流水号定位报关订单和渠道请求记录，查询最新回执。",
          "核对通道 autoRetry、timeInterval 及请求 modifyDate。",
          "未确认渠道结果前，不把支付成功等同于申报成功，也不直接重复申报。"
        ],
        "uncertainties": [
          "本案例未获得最终海关回执，不能确认最终申报结果。"
        ],
        "sources": [
          {
            "file": "cb/cb_trx/src/main/java/com/helipay/app/trx/web/controller/applycustoms/ApplyCustomsController.java",
            "line": 70,
            "symbol": "applyCustoms",
            "note": "请求校验后调用 applyCustomsBiz.applyCustomsOrder。"
          },
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/controller/job/applycustoms/ApplyCustomsOrderQueryTimer.java",
            "line": 51,
            "symbol": "execute",
            "note": "筛选未完成订单，调用 channelQuery。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/applycustoms/ApplyCustomsBizImpl.java",
            "line": 660,
            "symbol": "channelQuery / autoRetryAfterQuery",
            "note": "比较渠道状态，按配置和时间条件重试或完成更新。"
          }
        ],
        "diagnosis": "待核实",
        "merchant": "远航贸易",
        "channel": "业务渠道",
        "channelId": "SBX-CB202609200003",
        "time": "2026-09-20 10:30:00"
      }
    ]
  },
  {
    "id": "hk-cb",
    "name": "MSO",
    "repository": "hk-cb",
    "commit": "ebe71505dff18eec236557af301ada9591fa0b10",
    "description": "外币付款、收款人报备与虚拟账户",
    "businesses": [
      "外币付款",
      "境外收款人",
      "虚拟账户"
    ],
    "services": [
      {
        "name": "cb_merchant_api",
        "role": "商户付款入口"
      },
      {
        "name": "cb_trx",
        "role": "收款人与 VA 接入"
      },
      {
        "name": "cb_daemon",
        "role": "明细扣款与报备消费"
      }
    ],
    "cases": [
      {
        "id": "HK202609200001",
        "business": "外币付款",
        "scenario": "付款主单扣款中，部分明细尚未完成",
        "question": "主单一直显示扣款中，能直接重发整批吗？",
        "status": "DEBITING",
        "statusLabel": "DEBITING",
        "amount": "24000.00",
        "currency": "USD",
        "pipeline": [
          {
            "label": "确认付款",
            "service": "cb_merchant_api",
            "detail": "ForeignPayOrderController"
          },
          {
            "label": "余额与状态检查",
            "service": "cb_merchant_api",
            "detail": "cb_common：confirmPay"
          },
          {
            "label": "明细扣款队列",
            "service": "cb_daemon",
            "detail": "QUEUE_CB_FOREIGNPAY_DETAIL_DEAL"
          },
          {
            "label": "明细处理",
            "service": "cb_daemon",
            "detail": "ForeignPayDetailBiz.debit"
          },
          {
            "label": "主单汇总",
            "service": "cb_daemon",
            "detail": "updateOrderStatus"
          }
        ],
        "events": [
          {
            "service": "cb_merchant_api",
            "event": "PAYMENT_CONFIRMED",
            "detail": "orderNo=FP001 orderStatus=DEBITING"
          },
          {
            "service": "cb_daemon",
            "event": "DETAIL_DISPATCH",
            "detail": "orderNo=FP001 detailId=DT001 type=DEBIT"
          },
          {
            "service": "cb_daemon",
            "event": "DETAIL_PENDING",
            "detail": "orderNo=FP001 initCount=1 orderStatus=DEBITING"
          }
        ],
        "title": "仍有待扣款明细，主单暂不进入下一阶段",
        "summary": "源码在主单 DEBITING 状态下统计 INIT 明细；数量不为零时直接返回等待下次查询更新。当前记录符合该分支，不能仅凭主单状态判断整批失败。",
        "actions": [
          "按主单号查出仍为 INIT 的明细，关联 detailId 的队列消费及账户记录。",
          "核查明细消费、锁竞争和异常记录，判断是否未消费或未完成。",
          "不要重发整批扣款；确认每笔明细结果和幂等条件后由授权人员处理。"
        ],
        "uncertainties": [
          "待扣款明细未完成的根因尚未确定，不能直接归因于余额不足。",
          "COMPLETE 表示主单处理完成，并不保证所有明细付款成功。"
        ],
        "sources": [
          {
            "file": "cb/cb_merchant_api/src/main/java/com/helipay/app/merchant/web/controller/foreignpay/ForeignPayOrderController.java",
            "line": 147,
            "symbol": "confirmPay",
            "note": "验证交易密码后调用业务层。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/foreignpay/ForeignPayOrderBizImpl.java",
            "line": 276,
            "symbol": "confirmPay",
            "note": "校验 DEBIT 与可用余额，更新 DEBITING 并发送明细扣款消息。"
          },
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/listener/foreignpay/ForeignPayDetailDealListener.java",
            "line": 27,
            "symbol": "process",
            "note": "按明细 ID 加锁，DEBIT 消息调用 debit。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/foreignpay/ForeignPayOrderBizImpl.java",
            "line": 447,
            "symbol": "updateOrderStatus",
            "note": "依据 INIT、DOFAIL、DOING 数量更新主单状态。"
          }
        ],
        "diagnosis": "待核实",
        "merchant": "港联商务",
        "channel": "业务渠道",
        "channelId": "SBX-HK202609200001",
        "time": "2026-09-20 10:30:00"
      },
      {
        "id": "HK202609200002",
        "business": "境外收款人",
        "scenario": "收款人已创建，渠道报备尚未完成",
        "question": "收款人已经 ACTIVE，为什么渠道还不能使用？",
        "status": "ACTIVE / 报备待完成",
        "statusLabel": "ACTIVE / 报备待完成",
        "amount": "—",
        "currency": "—",
        "pipeline": [
          {
            "label": "创建收款人",
            "service": "cb_trx",
            "detail": "InterReceiveInfoApiController"
          },
          {
            "label": "报备任务生成",
            "service": "cb_trx",
            "detail": "cb_common：createOrUpdateForApi"
          },
          {
            "label": "报备消息消费",
            "service": "cb_daemon",
            "detail": "QUEUE_CB_INTERRECEIVE_REPORT"
          },
          {
            "label": "任务锁与报备",
            "service": "cb_daemon",
            "detail": "dealReportTask / doChannelReport"
          }
        ],
        "events": [
          {
            "service": "cb_trx",
            "event": "RECEIVER_CREATED",
            "detail": "receiverId=RCVHK002 status=ACTIVE taskId=RP002"
          },
          {
            "service": "cb_daemon",
            "event": "REPORT_TASK_RECEIVED",
            "detail": "receiverId=RCVHK002 taskId=RP002 taskStatus=INIT"
          },
          {
            "service": "cb_daemon",
            "event": "REPORT_LOCK_TIMEOUT",
            "detail": "receiverId=RCVHK002 taskId=RP002"
          }
        ],
        "title": "收款人状态与渠道报备分离，本次任务未取得处理锁",
        "summary": "创建收款人会生成渠道报备任务和通知记录。当前消费记录显示获取锁超时，未在本次尝试进入 doChannelReport；ACTIVE 不能替代渠道报备结果。",
        "actions": [
          "通过 receiverId 和任务 ID 关联报备任务、MQ 消费及渠道报备记录。",
          "检查是否有并行任务持锁和已经完成的渠道结果。",
          "确认任务补偿安排；不要因锁超时直接删除锁或重复创建收款人。"
        ],
        "uncertainties": [
          "其他任务可能已经报备，当前一次锁超时不能证明渠道从未收到请求。"
        ],
        "sources": [
          {
            "file": "cb/cb_trx/src/main/java/com/helipay/app/trx/web/controller/inter/InterReceiveInfoApiController.java",
            "line": 42,
            "symbol": "createOrUpdate",
            "note": "接入收款人创建更新请求。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/inter/InterReceiveInfoBizImpl.java",
            "line": 250,
            "symbol": "createOrUpdateForApi",
            "note": "保存资料后创建报备任务及商户通知记录。"
          },
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/listener/inter/InterReceiveInfoTaskListener.java",
            "line": 20,
            "symbol": "processReport",
            "note": "报备队列消费 ID 并调用 dealReportTask。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/biz/inter/InterReceiveInfoBizImpl.java",
            "line": 395,
            "symbol": "dealReportTask",
            "note": "INIT 任务取得锁后才调用渠道报备。"
          }
        ],
        "diagnosis": "待核实",
        "merchant": "港联商务",
        "channel": "业务渠道",
        "channelId": "SBX-HK202609200002",
        "time": "2026-09-20 10:30:00"
      },
      {
        "id": "HK202609200003",
        "business": "虚拟账户",
        "scenario": "开户回调已到，渠道交互记录未匹配",
        "question": "VA 开户仍在处理中，回调为什么没有更新账户？",
        "status": "DOING",
        "statusLabel": "DOING",
        "amount": "—",
        "currency": "USD",
        "pipeline": [
          {
            "label": "开户申请",
            "service": "cb_trx",
            "detail": "VirtualAccountController"
          },
          {
            "label": "创建交互记录",
            "service": "cb_trx",
            "detail": "cb_common：applyECheck"
          },
          {
            "label": "异步渠道交互",
            "service": "cb_daemon",
            "detail": "ChannelInterflowListener"
          },
          {
            "label": "开户状态回调",
            "service": "cb_trx",
            "detail": "cb_common：VAStatusChange"
          },
          {
            "label": "账户状态完成",
            "service": "cb_trx",
            "detail": "applyECheckComplete"
          }
        ],
        "events": [
          {
            "service": "cb_trx",
            "event": "VA_APPLY_ACCEPTED",
            "detail": "serialNumber=VA003 bizId=VA_BIZ003 vaAcctStatus=DOING"
          },
          {
            "service": "cb_trx",
            "event": "VA_CALLBACK",
            "detail": "bizId=VA_BIZ003 vaAcctStatus=DOING"
          },
          {
            "service": "cb_trx",
            "event": "INTERFLOW_NOT_FOUND",
            "detail": "bizId=VA_BIZ003 error=ORDER_NOT_EXIST"
          }
        ],
        "title": "回调定位到 VA，但未匹配到渠道交互记录",
        "summary": "源码在 VA 为 DOING 时，按渠道和 bizId 查询 ChannelInterflow；找不到时抛出订单不存在异常，无法进入 applyECheckComplete。沙箱案例对应这一分支。",
        "actions": [
          "核对 bizId、渠道编码、VA 记录及开户交互记录是否一致。",
          "追踪开户事务提交后的消息发送和 ChannelInterflow 处理过程。",
          "确认真实渠道开户结果后再评估修复；避免重复开户或手工伪造成功状态。"
        ],
        "uncertainties": [
          "当前缺少渠道最终开户状态，不能仅凭回调到达认定账户已可用。",
          "该扫描入口是特定的 applyECheck 路径，不能推广到所有 VA 产品。"
        ],
        "sources": [
          {
            "file": "cb/cb_trx/src/main/java/com/helipay/app/trx/web/controller/va/VirtualAccountController.java",
            "line": 59,
            "symbol": "applyECheck",
            "note": "调用 VirtualAccountManagerService。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/service/va/VirtualAccountManagerServiceImpl.java",
            "line": 122,
            "symbol": "applyECheck",
            "note": "限定 USD、US、EDUCATION；提交后发送渠道交互消息。"
          },
          {
            "file": "cb/cb_daemon/src/main/java/com/helipay/app/daemon/listener/sunrate/ChannelInterflowListener.java",
            "line": 1,
            "symbol": "ChannelInterflowListener",
            "note": "异步渠道交互消费者；回调到达是另一条入口，不代表同步调用。"
          },
          {
            "file": "cb/cb_common/src/main/java/com/helipay/common/base/service/va/VirtualAccountManagerServiceImpl.java",
            "line": 429,
            "symbol": "VAStatusChange",
            "note": "DOING 时按渠道和 bizId 查询交互记录，缺失则抛错。"
          }
        ],
        "diagnosis": "待核实",
        "merchant": "港联商务",
        "channel": "业务渠道",
        "channelId": "SBX-HK202609200003",
        "time": "2026-09-20 10:30:00"
      }
    ]
  }
];

window.workspaceData = {
  get(id='card') {
    const w=window.workspaceCatalog.find(w=>w.id===id);
    if(!w)throw Error('工作空间不存在');
    return w;
  },
  services(id) {
    const w=this.get(id);
    return w.services.map(s=>({...s,project:w.name,environment:'沙箱',logFile:`logs/${s.name}.log`,version:w.commit?w.commit.slice(0,8):'v1.0',enabled:true}));
  },
  knowledge(id) {
    const w=this.get(id);
    if(!w.repository)return {scanEnabled:false,projects:[],markdown:'',updatedAt:null};
    return {scanEnabled:false,projects:[{name:w.repository,path:`/Users/liuyuhao/IdeaProjects/${w.repository}`,branch:'master'}],updatedAt:null,
      markdown:`# ${w.name}业务说明\n\n来源：${w.repository} / master / ${w.commit}。静态代码审阅，不代表生产部署版本。\n\ncb_common 是共享业务模块，不是独立服务器。以下是业务步骤，不能将每一步理解为跨服务 RPC。\n\n`+w.cases.map(c=>`## ${c.business}\n${c.pipeline.map(p=>`${p.label}（${p.service} / ${p.detail}）`).join(' → ')}\n\n${c.sources.map(s=>`- ${s.file}:${s.line} / ${s.symbol}：${s.note}`).join('\n')}\n\n排查重点：${c.actions.join('；')}\n`).join('\n')};
  },
  report(id,body,services) {
    const w=this.get(id),c=w.cases.find(c=>c.id===(body.transactionId||'').trim());
    if(!c)throw Error('当前工作空间未找到该流水号，请核对业务范围');
    const enabled=new Set(services.filter(s=>s.enabled).map(s=>s.name));
    const evidence=c.events.filter(e=>enabled.has(e.service)).map((e,i)=>({id:'E'+(i+1),service:e.service,file:`sandbox/${e.service}.log`,line:i+1,matchedBy:c.id,text:`2026-09-20T10:30:${String(i+1).padStart(2,'0')} transaction=${c.id} event=${e.event} ${e.detail} source=SANDBOX`,context:'按已审阅业务分支构造的沙箱证据，未读取生产日志。'}));
    const missing=[...new Set(c.events.map(e=>e.service))].filter(s=>!enabled.has(s));
    return {id:globalThis.crypto?.randomUUID?.()||'case-'+Date.now()+'-'+Math.random().toString(16).slice(2),workspaceId:id,workspaceName:w.name,createdAt:new Date().toISOString(),transaction:{id:c.id,merchant:c.merchant,amount:c.amount,currency:c.currency,status:c.status,statusLabel:c.statusLabel,channel:c.channel,channelId:c.channelId,time:c.time,business:c.business},question:body.question||'',
      diagnosis:missing.length?'待核实':c.diagnosis,title:missing.length?'数据源未完整启用，当前证据不足':c.title,
      summary:missing.length?`缺少 ${missing.join('、')} 的日志覆盖，不能确认预设场景结论。请补齐数据源后重新排查。`:c.summary,
      actions:missing.length?['检查服务配置与日志覆盖范围，重新排查。','保留当前证据，避免凭日志缺失判断业务未执行。']:c.actions,
      uncertainties:missing.length?[`未覆盖服务：${missing.join('、')}`,...c.uncertainties]:c.uncertainties,
      evidence,code:{},pipeline:c.pipeline,sources:c.sources,repository:w.repository,commit:w.commit,
      steps:[{title:'定位业务单据',detail:`${w.name} / ${c.business}`,count:1},...w.services.filter(s=>c.events.some(e=>e.service===s.name)).map(s=>({title:`检索 ${s.name}`,detail:enabled.has(s.name)?'按流水号关联沙箱日志':'数据源未启用，缺少覆盖',count:evidence.filter(e=>e.service===s.name).length})),{title:'核对业务分支',detail:`${w.repository} master 静态审阅摘要，非运行时扫描`,count:c.sources.length}],
      mode:'规则诊断 · 沙箱数据',durationMs:0,feedback:{},ai:{status:'disabled',text:'可结合当前业务文档、代码来源摘要和日志证据进行 AI 分析。'}};
  }
};
