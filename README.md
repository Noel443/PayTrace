# PayTrace 纯前端原型

当前先验证页面与业务流程，不需要 Java、Maven、数据库或 AI 服务。

## 直接打开

双击 `frontend/index.html` 即可使用。

## 本地 HTTP 访问（可选）

需要固定地址或通过 ngrok 展示时，在项目根目录运行：

```sh
npm start
```

访问 http://127.0.0.1:5173 。无需 npm install，仅需 Node.js。端口冲突可用 `PORT=5174 npm start`。

另开终端运行 `ngrok http 5173`。当前只有公开样例数据，没有登录或生产连接，不要放入真实交易信息。

## 可以体验

- 三种场景：支付成功但通知失败、渠道拒绝、渠道超时最终状态未知。
- 按交易号检索内置样例，沿消息 ID 关联 trx 与 daemon。
- 展开日志、上下文与示例代码，查看结论与待确认事项。
- 导出 Markdown 排查单、保存处理反馈、查看历史。
- 服务开关影响排查结果；关闭 daemon 后，通知失败案例变为证据不足。

记录保存在当前浏览器 localStorage，不同浏览器或地址互不共享。清理站点数据会删除记录；存储不可用时退化为页面内存，刷新后丢失。

所有分析为前端预设规则，不请求 AI 或真实服务器。问题描述被记录到报告，但不参与自然语言推理。

## 文件

- `frontend/index.html`：页面结构。
- `frontend/style.css`：响应式样式。
- `frontend/app.js`：交互与导出。
- `frontend/mock-api.js`：模拟数据层，后续可替换为真实 API。
- `docs/architecture.md`：后续架构草案。

`src/` 保留此前开始编写的 Java 草稿，尚未验证，当前页面不依赖它。先确认前端，再继续后端开发。
