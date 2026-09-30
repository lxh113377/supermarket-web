-- 回滚 migrate-promotions.sql（回滚前先全量备份）
-- 整表回滚轨：删两张表（删表自动带走其索引）；订单快照 orders.totalAmount 已是实付价，
-- 删优惠明细不影响已落库总额（对账口径见 order_discounts，删后不可追溯，以备份为准）。
DROP TABLE IF EXISTS order_discounts;
DROP TABLE IF EXISTS promotions;
