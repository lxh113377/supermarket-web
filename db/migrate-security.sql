-- 安全加固迁移（2026-08-23）：限流计数表 + 安全审计日志表
-- 执行：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --remote --file=db/migrate-security.sql

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket  TEXT PRIMARY KEY,
  count   INTEGER DEFAULT 0,
  resetAt INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS security_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL,
  ip             TEXT DEFAULT '',
  action         TEXT DEFAULT '',
  result         TEXT DEFAULT '',
  keyFingerprint TEXT DEFAULT '',
  detail         TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_security_events_ts ON security_events (ts);
