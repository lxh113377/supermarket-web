-- 回滚 migrate-add-product-dongmai.sql：删除本次新增的「脉动」（order 71）。
-- 精确定位：按 "order" 与 name 双条件 —— 正向件已改成 order 存在性守卫（见其文件头说明），
--   生产行可能是 API 建的 p_<ts> 形态，按 _id='p071' 删会漏。
-- 只删本次新增行；既有商品不受影响。幂等：删除不存在的行不报错。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-add-product-dongmai.sql --remote
DELETE FROM products WHERE "order" = 71 AND name = '脉动';
