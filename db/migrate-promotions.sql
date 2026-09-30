-- 满减促销最小闭环（2026-09-30 对标 P2：mall 满减 / medusa Promotion 的最小可用子集）
-- 口径：threshold 满额门槛（元），discount 减免额（元），enabled=1 才参与；
-- 服务端按下单小计自动选最优一档（discount 最大），金额服务端重算，前端不传。
-- 默认种子为关闭态（enabled=0）⇒ 存量行为零变化；管理端开关 UI 后续轮次再加。
--
-- 纪律（verify-migrate-replay A3）：新迁移必须可在基线库上连跑两次 ⇒ 禁裸 ALTER。
-- 订单侧优惠不加列，进新表 order_discounts（orderId 主键，一单一档）；老库缺表时
-- 后端防御式回落（bestPromotion/getDiscount 均 try/catch ⇒ 零优惠），行为与旧版一致。
-- 执行方式（chaoshi-web-deploy skill）：先备份、走 node scripts/migrate.mjs apply（账目表通道），禁裸 d1 execute。
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
INSERT OR IGNORE INTO promotions (_id, name, threshold, discount, enabled, createdAt, updatedAt)
VALUES ('promo_default', '开业满减', 50, 5, 0, datetime('now'), datetime('now'));
