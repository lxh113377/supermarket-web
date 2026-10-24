-- 回滚 migrate-add-product-zhengda-wuhuaguo.sql：删除本次新增的「正大无花果」
-- 精确定位：按 _id='p065' 与 "order"=65 双条件，避免误删同名商品。
-- 只删本次新增行；既有商品不受影响。幂等：删除不存在的行不报错。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-add-product-zhengda-wuhuaguo.sql --remote
DELETE FROM products WHERE _id = 'p065' AND "order" = 65;
