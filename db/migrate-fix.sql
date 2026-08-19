-- 一次性迁移：为已创建的远程 D1 补齐缺失列（schema.sql 已修正，本文件仅用于存量库）。
-- 已建库此前用旧 schema 建表，缺 products.createdAt/updatedAt 与 submissions.updatedAt，
-- 导致 createProduct / updateProduct / updateSubmissionStatus 报 "no column named ..."。
-- 新增列均为可空 TEXT，不会破坏已写入的 49 商品/订单/评价数据。仅需运行一次。
ALTER TABLE products ADD COLUMN createdAt TEXT;
ALTER TABLE products ADD COLUMN updatedAt TEXT;
ALTER TABLE submissions ADD COLUMN updatedAt TEXT;
