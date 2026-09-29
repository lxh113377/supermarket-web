-- 第五十六轮 E7：库存流水表 `stock_movements`（借同域三仓的现形形状，见下方注）
-- 一手缺口：`products.stock` 原先只是一个**当前值**（INTEGER DEFAULT -1，-1=不限售），
-- 出入库、盘点纠错、取消回补全都不可追溯 —— 而同域三个参照仓**每一个**都带一张流水：
--   opensourcepos/opensourcepos（4,409★，单店 POS，2026-09-29 当日在推）
--     `ospos_inventory(trans_id, trans_items, trans_user, trans_date, trans_inventory 有符号)`，
--     卖货时先改快照 `changeQuantity(-qty)` 再插一行流水（app/Models/Sale.php:647 → :662-673）
--   grocy/grocy（9,542★，同为 SQLite）`stock_log(amount, transaction_type, undone, correlation_id, ...)`
--   inventree/InvenTree（7,654★）`StockItemTracking(tracking_type, deltas JSONField, ...)`
-- 三仓共同点：**快照是当前真相源、流水只做追溯与报表**，且都不按流水回算快照。
-- 本表比它们多做一步：写入即记账，并由 `docs/API.md` 记的不变式（有限库存商品 SUM(delta)==stock）
-- 让"流水与快照脱节"当场可见——这是三个参照仓都没有的那一半，也是本仓唯一能机器判的那一半。
--
-- 迁移：db/migrate-stock-movements.sql（含期初建账 INSERT）；回滚：db/rollback-stock-movements.sql
-- 列定义必须与 db/schema.sql 逐字段一致，由 `npm run verify:migrate-replay` 的 A5 判。

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

-- 流水页与按商品对账两条路径各一条索引（grocy 同样只索引这两向：product_id×时间、类型×时间）
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_ts ON stock_movements (productId, createdAt);
CREATE INDEX IF NOT EXISTS idx_stock_movements_kind_ts ON stock_movements (kind, createdAt);

-- 期初建账：把每个"有限库存"商品的当前值记成第一条流水，于是不变式对**全部**在册商品成立，
-- 而不是只对建账之后动过的那些。带 NOT EXISTS 守卫 ⇒ 重放两次不多记（A3 幂等纪律）。
INSERT INTO stock_movements (productId, delta, kind, refType, refId, actor, note, createdAt)
SELECT p._id, p.stock, 'init', 'ledger', '', 'system', '期初建账（第五十六轮 E7）', COALESCE(p.updatedAt, p.createdAt)
FROM products p
WHERE p.stock >= 0
  AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.productId = p._id AND m.kind = 'init');
