-- 超市 web 后端 D1 schema（替代原 CloudBase 文档库集合）
-- 字段中的数组/对象以 JSON 文本存储。

CREATE TABLE IF NOT EXISTS categories (
  _id           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT '',
  "order"       INTEGER DEFAULT 0,
  subcategories TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS products (
  _id           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  spec          TEXT DEFAULT '',
  price         REAL DEFAULT 0,
  costPrice     REAL DEFAULT 0,
  subcategories TEXT DEFAULT '[]',
  enabled       INTEGER DEFAULT 1,
  "order"       INTEGER DEFAULT 0,
  image         TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  description   TEXT DEFAULT '',
  specOptions   TEXT DEFAULT '[]',
  reviews       TEXT DEFAULT '[]',
  stock         INTEGER DEFAULT -1,
  createdAt     TEXT,
  updatedAt     TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  _id               TEXT PRIMARY KEY,
  roomNumber        TEXT DEFAULT '',
  items             TEXT DEFAULT '[]',
  totalAmount       REAL DEFAULT 0,
  status            TEXT DEFAULT 'pending',
  wechat            TEXT DEFAULT '',
  remark            TEXT DEFAULT '',
  paymentScreenshot TEXT DEFAULT '',
  idempotencyKey    TEXT,
  createdAt         TEXT,
  updatedAt         TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  _id           TEXT PRIMARY KEY,
  productOrder  INTEGER,
  "user"        TEXT DEFAULT '匿名用户',
  rating        INTEGER DEFAULT 5,
  text          TEXT DEFAULT '',
  images        TEXT DEFAULT '[]',
  createdAt     TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  _id           TEXT PRIMARY KEY,
  serviceId     TEXT DEFAULT '',
  serviceName   TEXT DEFAULT '',
  categoryId    TEXT DEFAULT '',
  categoryName  TEXT DEFAULT '',
  formData      TEXT DEFAULT '{}',
  images        TEXT DEFAULT '[]',
  status        TEXT DEFAULT 'pending',
  createdAt     TEXT,
  updatedAt     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_productOrder ON reviews (productOrder);
CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders (createdAt);
-- 增量轮询（2026-09-05 H1-1）：管理端按 updatedAt 游标拉新增/变更订单，避免全量拉取
CREATE INDEX IF NOT EXISTS idx_orders_updatedAt ON orders (updatedAt);
CREATE INDEX IF NOT EXISTS idx_products_order ON products ("order");
CREATE INDEX IF NOT EXISTS idx_submissions_createdAt ON submissions (createdAt);
-- 优化批次（2026-08-28）：看板 90/365 天聚合 + status/roomNumber 筛选 + enabled 过滤走索引，降低 D1 全表扫配额成本
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_roomNumber ON orders (roomNumber);
-- 下单幂等（2026-09-24 A1）：部分唯一索引，只约束带幂等键的新单，历史单/匿名直连单为 NULL 不受影响
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotencyKey) WHERE idempotencyKey IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_enabled ON products (enabled);
CREATE INDEX IF NOT EXISTS idx_reviews_createdAt ON reviews (createdAt);

-- 限流计数（D1 持久，跨实例有效；bucket = rate:{action}:{ip}）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket  TEXT PRIMARY KEY,
  count   INTEGER DEFAULT 0,
  resetAt INTEGER DEFAULT 0
);

-- 安全审计日志（管理写操作与认证失败；keyFingerprint 为密钥指纹，不存原始密钥）
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

-- AI 调用留痕（2026-09-18 双向迭代 R4）：scene/source/ok/fallback/latencyMs/tokens/keyFp
-- keyFp 为密钥指纹（SHA-256 前 8 位），绝不落明文密钥。
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

-- 迁移账目表（第十一轮恢复演练判据首跑抓出来的缺口）：本表在生产与本地 D1 里真实存在，
-- 但一直只由 scripts/migrate.mjs 运行时 CREATE，从未进过全量真相源 schema.sql。
-- 补在此处 = 让「一份完整库长什么样」只有一个答案；migrate.mjs 侧仍是 IF NOT EXISTS，幂等不受影响。
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  appliedAt  TEXT NOT NULL,
  note       TEXT DEFAULT ''
);
