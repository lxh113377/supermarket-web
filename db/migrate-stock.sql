-- 库存字段迁移（2026-09-24 对标 C1，用户裁决执行）
-- stock = -1 表示不限售（存量商品默认值 = 迁移前行为，向后兼容）
-- 执行方式（chaoshi-web-deploy skill）：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/migrate-stock.sql --remote
-- ⚠️ 顺序铁律：先跑本迁移、再部署引用 stock 列的代码（SQLite ALTER 单列可重复执行会报错，重跑前先确认列已存在）
ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT -1;
