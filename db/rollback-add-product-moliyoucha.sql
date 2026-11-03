-- 回滚 migrate-add-product-moliyoucha.sql：删除本次新增的「康师傅茉莉柚茶」(order 69)。
-- 精确定位：按 _id 与 "order" 双条件，避免误删同名商品。
-- 只删本次新增行；既有商品不受影响。幂等：删除不存在的行不报错。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-add-product-moliyoucha.sql --remote
DELETE FROM products WHERE _id = 'p069' AND "order" = 69;
