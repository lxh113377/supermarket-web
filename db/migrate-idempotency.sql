-- 下单幂等键迁移（2026-09-24 对标第二轮，A1）
-- 对标依据：Medusa 唯一索引 `UNIQUE INDEX idempotency_key_id (idempotency_key, id)`、
--           Saleor 用 `checkout_token + checkout_line` 唯一约束做同义去重、
--           litemall `cart_checkout` 唯一索引 + `@DistributedLock` 双层。
--
-- 用**部分唯一索引**（WHERE ... IS NOT NULL）：SQLite 的 UNIQUE 允许多行 NULL，
-- 因此不带幂等键的历史订单与匿名直连请求不受任何影响，只有带键的新单被约束。
--
-- ⚠️ 顺序铁律（同 migrate-stock.sql）：先跑本迁移、再部署引用 idempotencyKey 列的代码，
--    否则线上会报 "no column named idempotencyKey"（见 migrate-fix.sql 记录的同款事故）。
-- 执行：node scripts/migrate.mjs apply --remote   （账目表自动记录，不会重放）

ALTER TABLE orders ADD COLUMN idempotencyKey TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotencyKey) WHERE idempotencyKey IS NOT NULL;
