-- 第六十轮 M-59-1：事件流水表 `event_log`（事件总线第 3 步消费者的落点）。
--
-- 一手缺口：events.js 的 emit() 只记内存队列，喊完即散 —— 下单/改状态/取消/缺货这些事件
-- 没有任何一行持久化，"某单经历过哪些事件"无处可查。本表补的就是这一半。
-- 口径只收白名单 6 字段（type/at/orderId/status/totalAmount/discountAmount），
-- 微信号/备注/房间号/付款截图从不进队列，本表天然无 PII 列。
--
-- 迁移：db/migrate-event-log.sql；回滚：db/rollback-event-log.sql
-- 列定义必须与 db/schema.sql 逐字段一致，由 `npm run verify:migrate-replay` 的 A5 判。
-- 无期初建账：内存队列本就无历史可迁，建账 INSERT 会凭空造事件，禁写。

CREATE TABLE IF NOT EXISTS event_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,
  at             TEXT NOT NULL,
  orderId        TEXT NOT NULL,
  status         TEXT DEFAULT '',
  totalAmount    REAL DEFAULT 0,
  discountAmount REAL DEFAULT 0,
  createdAt      TEXT NOT NULL
);

-- 唯一读路径（按单查时间线）一条索引
CREATE INDEX IF NOT EXISTS idx_event_log_order_ts ON event_log (orderId, at);
