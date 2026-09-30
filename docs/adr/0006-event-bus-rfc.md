# ADR-0006 事件总线 RFC（对标 medusa Workflow/插件制）

状态：提议（2026-09-30）
背景：写 action 增多后出现第二登记点（DASHBOARD_WRITE_ACTIONS 看板缓存失效、库存流水、webhook 通知），靠人工登记易漏；第三方集成只有一个 ORDER_WEBHOOK_URL 单钩子。
决定（分三步，不改线上行为先立约）：
1. 约定领域事件名：`order.created / order.status_changed / order.cancelled / product.stock_low / product.stock_out / review.created / submission.created`，载荷只含 id+状态+金额类最小集（禁微信号/付款截图，随 webhook 口径）。
2. 后端加 `functions/lib/events.js` 纯函数 `emit(type,payload)`：本阶段只记内存队列+复用现有 webhook 投递一次，不新增外部依赖；KV/D1 均不动。
3. 新增写 action 必须在同一 PR 内登记事件映射表，否则 `verify:contract` 扩展腿判红（ Internationally 先文档后代码）。
否决：引入 Redis PubSub / 队列服务（F1 架构前提不成立：CF Pages 免费层无常驻进程）。
验收：`docs/openapi.json` paths 数与契约一致；新增事件有单测；零部署风险（纯新增文件+文档）。
