-- 一次性数据修正：order 20 正式品名去掉促销语「（亏本卖）」
-- 改前实测值（2026-09-25 D1 只读回捞）：_id=p020, name='猎兽功能饮料（亏本卖）', price=1.5, enabled=1
-- 只动 name。price 以 D1 现值 1.5 为准，src/data/products-seed.ts 里的 2.33 已过期，严禁用 seed 覆盖。
UPDATE products SET name='猎兽功能饮料' WHERE "order"=20;
