-- 增量迁移（2026-09-18 双向迭代 R4）：AI 调用留痕表
-- 线上 D1 执行：
--   npx wrangler d1 execute supermarket-db --remote --file=db/migrate-ai-calls.sql
-- 说明：CREATE TABLE IF NOT EXISTS 为幂等操作，可重复执行；两张索引支撑"近 N 条"与"按场景统计"。
CREATE TABLE IF NOT EXISTS ai_calls (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  scene     TEXT DEFAULT '',
  source    TEXT DEFAULT '',
  ok        INTEGER DEFAULT 0,
  fallback  INTEGER DEFAULT 0,
  latencyMs INTEGER DEFAULT 0,
  tokens    INTEGER,
  keyFp     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_ts ON ai_calls (ts);
CREATE INDEX IF NOT EXISTS idx_ai_calls_scene_ts ON ai_calls (scene, ts);
