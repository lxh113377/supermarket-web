# ADR-0006 事件总线 RFC（对标 medusa Workflow/插件制）

状态：部分实施（2026-09-30 提议；进度取 2026-10-02 实测）
背景：写 action 增多后出现第二登记点（DASHBOARD_WRITE_ACTIONS 看板缓存失效、库存流水、webhook 通知），靠人工登记易漏；第三方集成只有一个 ORDER_WEBHOOK_URL 单钩子。
决定（分三步，不改线上行为先立约）：
1. 约定领域事件名：`order.created / order.status_changed / order.cancelled / product.stock_low / product.stock_out / review.created / submission.created`，载荷只含 id+状态+金额类最小集（禁微信号/付款截图，随 webhook 口径）。
2. 后端加 `functions/lib/events.js` 纯函数 `emit(type,payload)`：本阶段只记内存队列+复用现有 webhook 投递一次，不新增外部依赖；KV/D1 均不动。
3. 新增写 action 必须在同一 PR 内登记事件映射表，否则 `verify:contract` 扩展腿判红（ Internationally 先文档后代码）。
否决：引入 Redis PubSub / 队列服务（F1 架构前提不成立：CF Pages 免费层无常驻进程）。
验收：`docs/openapi.json` paths 数与契约一致；新增事件有单测；零部署风险（纯新增文件+文档）。

## 实施进度（2026-10-02 实测；编号只认本节这四条）

> **先纠一处分裂口径**：工作区台账（第五十八、五十九轮报告与 CHANGELOG）把"消费者"称作"事件总线第 3 步"，
> 而本 RFC 的第 3 条写的是"新增写 action 登记事件映射表"——**两件不同的事共用了同一个编号**，
> 谁照编号办事都会做错一件。本轮起台账侧写"消费者"，不再写"第 3 步"。

1. 事件名 + 载荷白名单 —— **已实施**：`functions/lib/events.js` 的 `KNOWN` 七事件 + 6 字段白名单（白名单外的 type 直接 `{emitted:false}`）。
2. `emit()` 内存队列 + 复用既有 webhook 投递 —— **已实施**（第五十八轮 M-58-2）。
3. 消费者（队列 → D1 落表）—— **2026-10-02 已实施**：`functions/lib/event_sink.js` 在响应定稿后经 `waitUntil`
   落 `event_log`（建账 `db/migrate-event-log.sql`，回滚 `db/rollback-event-log.sql`）；
   单测 `tests/eventSink.test.js` 6 条（空队列零写盘／白名单列序／落完即空／D1 未绑定只 warn／抛错被吞／不 await）。
4. 新增写 action 登记事件映射表，否则 `verify:contract` 扩展腿判红 —— **未实施**：本契约判据现印 48 条，
   其中没有事件映射这一腿，仍停在"先文档后代码"的文档态 ⇒ 整份 RFC 的状态因此是**部分实施**，不是"已落地"。

**未完成面（不得读成"事件总线做完了"）**：
- **只写不读**：实测 `grep -rn "event_log" functions/` 除 `event_sink.js` 本体外只剩两处注释，且 `event_sink.js`
  内 `SELECT` 命中 0 ⇒ 没有任何 action 能查这张表，"某单经历过哪些事件"今天只能直接查库。
- **无保留期、无删除通道**：`deleteOrder` 不认本表 ⇒ 删单后其事件行全部成孤儿（行数 ≥ 该单事件数）。
  已按户内规矩挂进 `docs/pii-inventory.md`「已知缺口」第 6 条；开清理通道前须先登记分母，不得先动手。
