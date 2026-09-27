-- 回滚 migrate-taste-baixiang.sql：清空 order 46 的口味清单（还原迁移前的 specOptions='[]'）
-- 还原值取自 2026-09-28 `wrangler d1 export supermarket --remote` 的生产快照
-- （备份文件 supermarket-pre-baixiang.sql，1,461,184 B，已载回 sqlite 断言 p046.specOptions='[]'）。
-- ⚠️ 只还原 specOptions 一列。**不动 spec**：线上 p046.spec 本来就是 '帮泡'，迁移也没改它。
-- ⚠️ 只在同时回退了引用 specOptions 的前端之后执行，否则顾客端选择器消失、口味无从选择。
-- ⚠️ 只还原目录数据，不改历史订单：已下的单里 items.spec 仍是当时落库的字符串；
--    splitOrderSpec 对不含「 · 」的老单返回 flavor='' ⇒ 后台不显示口味徽标（既有口径：不替老单猜口味）。
-- 执行方式：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/rollback-taste-baixiang.sql --remote
-- 幂等：按 "order" 定位，可安全重跑。
UPDATE products SET specOptions='[]' WHERE "order"=46;
