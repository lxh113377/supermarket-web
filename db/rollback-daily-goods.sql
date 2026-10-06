-- 回滚 migrate-daily-goods.sql：删除本次新增的「日用」分类与 4 个商品
-- 精确定位：分类按 _id='daily'，商品按 "order" IN (60,61,62,63)。
-- 只删本次新增行；既有分类/商品不受影响。幂等：删除不存在的行不报错。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-daily-goods.sql --remote
DELETE FROM products WHERE "order" IN (60, 61, 62, 63);
DELETE FROM categories WHERE _id = 'daily';