-- 回滚 migrate-add-product-wahaha-yingyangkuaixian.sql：删除本次新增的「哇哈哈营养快线」(order 70)。
-- 精确定位：按 _id 与 "order" 双条件，避免误删同名商品。
-- 只删本次新增行；既有商品不受影响。幂等：删除不存在的行不报错。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-add-product-wahaha-yingyangkuaixian.sql --remote
DELETE FROM products WHERE _id = 'p070' AND "order" = 70;
