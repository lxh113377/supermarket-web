-- 回滚 migrate-taste-baixiang5-p047.sql：把 order 47 的口味清单还原成改动前的空清单。
-- 还原值 = 2026-11-01 /pub 线上实测 p047.specOptions=[]（不是推测，是当场读数）。
-- ⚠️ 回滚后零售详情页不再渲染口味选择器（既有口径：无口味清单就不渲染，页面不替它编）。
-- ⚠️ 只还原目录数据，不改历史订单（同 p046 那件的理由）。
-- 幂等：按 "order" 定位，可安全重跑。
UPDATE products SET specOptions='[]' WHERE "order"=47;
