-- 回滚 adhoc-rename-order20.sql：还原 order 20 的品名促销语
-- 还原值取自 2026-09-25 生产 D1 只读回捞（改前 name），price 不在回滚范围内
UPDATE products SET name='猎兽功能饮料（亏本卖）' WHERE "order"=20;
