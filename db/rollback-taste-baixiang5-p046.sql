-- 回滚 migrate-taste-baixiang5-p046.sql：把 order 46 的口味还原成 2026-11-01 改动前的线上现值（旧三口味）。
-- 还原值取自 2026-11-01 /pub 的线上读数（带 enabled:true，逐字照抄，不做"顺手清理"）。
-- ⚠️ 只还原 specOptions 一列，不动 spec（线上 p046.spec 本来就是「帮泡」）。
-- ⚠️ 只还原目录数据，不改历史订单：已下的单里 items.spec 仍是当时落库的字符串，
--    splitOrderSpec 对不含「 · 」的老单返回 flavor=""，后台不显示口味徽标（既有口径：不替老单猜口味）。
-- 幂等：按 "order" 定位，可安全重跑。
UPDATE products SET specOptions='[{"label":"十三香","enabled":true},{"label":"麻辣香","enabled":true},{"label":"山西老陈醋","enabled":true}]' WHERE "order"=46;
