-- 回滚第六十轮 M-59-1 的事件流水表。
-- 顺序：先删索引再删表（SQLite 的 DROP TABLE 会连带删掉索引，但显式列出让回滚可读、可逐条核对）。
DROP INDEX IF EXISTS idx_event_log_order_ts;
DROP TABLE IF EXISTS event_log;
