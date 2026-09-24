-- 回滚 migrate-stock.sql：删除库存列（列内数据不可恢复，回滚前先全量备份）
ALTER TABLE products DROP COLUMN stock;
