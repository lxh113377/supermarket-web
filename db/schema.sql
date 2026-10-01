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

-- 库存流水（第五十六轮 E7，借同域三仓的现形形状：opensourcepos 的 ospos_inventory、
-- grocy 的 stock_log、InvenTree 的 StockItemTracking —— 三个"单店/库存"同类**每一个**都有流水，
-- 而本仓原先只有 products.stock 这一个当前值，出入库与盘点纠错不可追溯）。
-- 口径：delta 有符号（出为负）；kind ∈ init|sale|void|adjust；refType ∈ ledger|order|manual；
-- 不变式「有限库存商品 SUM(delta) == products.stock」由 scripts/verify-backend.mjs 的 L 组断言盯住
-- ——三个参照仓都不按流水回算快照，这一半是本仓自己加的。
-- 建账与回滚：db/migrate-stock-movements.sql / db/rollback-stock-movements.sql
CREATE TABLE IF NOT EXISTS stock_movements (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  productId TEXT NOT NULL,
  delta     INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  refType   TEXT DEFAULT '',
  refId     TEXT DEFAULT '',
  actor     TEXT DEFAULT '',
  note      TEXT DEFAULT '',
  voided    INTEGER DEFAULT 0,
  voidedAt  TEXT,
  createdAt TEXT NOT NULL
);

-- 流水页与按商品对账两条路径各一条索引（对齐 grocy：只索引 商品×时间 与 类型×时间 两向）
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_ts ON stock_movements (productId, createdAt);
CREATE INDEX IF NOT EXISTS idx_stock_movements_kind_ts ON stock_movements (kind, createdAt);

-- 满减促销（2026-09-30 对标 P2 最小闭环）：见 db/migrate-promotions.sql
-- 订单侧优惠不进 orders 列（禁裸 ALTER），单立 order_discounts 表（一单一档）。
CREATE TABLE IF NOT EXISTS promotions (
  _id       TEXT PRIMARY KEY,
  name      TEXT DEFAULT '',
  threshold REAL DEFAULT 0,
  discount  REAL DEFAULT 0,
  enabled   INTEGER DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_promotions_enabled ON promotions (enabled);
CREATE TABLE IF NOT EXISTS order_discounts (
  orderId        TEXT PRIMARY KEY,
  discountAmount REAL DEFAULT 0,
  promotionId    TEXT DEFAULT '',
  createdAt      TEXT
);

-- 事件流水（第六十轮 M-59-1：事件总线第 3 步消费者落点）。
-- 口径：只存 events.js 白名单里的 6 个字段（type/at/orderId/status/totalAmount/discountAmount），
-- 微信号/备注/房间号/付款截图从不进队列，故本表天然无 PII 列（PII 登记册无需新增行）。
-- 快照仍是各业务表自身；本表只做追溯（"某单经历过哪些事件"），不对任何业务状态回算。
-- 建账与回滚：db/migrate-event-log.sql / db/rollback-event-log.sql
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

-- 按单查某单事件时间线一条索引（唯一的读路径；报表式全表扫不在本轮范围）
CREATE INDEX IF NOT EXISTS idx_event_log_order_ts ON event_log (orderId, at);

