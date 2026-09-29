-- 回滚第五十六轮 E7 的库存流水表。
-- 顺序：先删索引再删表（SQLite 的 DROP TABLE 会连带删掉索引，但显式列出让回滚可读、可逐条核对）。
DROP INDEX IF EXISTS idx_stock_movements_kind_ts;
DROP INDEX IF EXISTS idx_stock_movements_product_ts;
DROP TABLE IF EXISTS stock_movements;
