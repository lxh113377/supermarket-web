-- 2026-08-28 优化批次：D1 索引补齐（本地 schema.sql 同步更新）
-- 线上执行：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/migrate-optimize-indexes.sql --remote
-- 目的：看板 90/365 天聚合 + status/roomNumber 筛选 + enabled 过滤走索引，降低 D1 全表扫配额成本

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_roomNumber ON orders (roomNumber);
CREATE INDEX IF NOT EXISTS idx_products_enabled ON products (enabled);
CREATE INDEX IF NOT EXISTS idx_reviews_createdAt ON reviews (createdAt);
