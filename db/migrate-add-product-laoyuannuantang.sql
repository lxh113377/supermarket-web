-- 新增商品：老酸奶软糖 ¥0.5（2026-10-21）
-- 背景：用户口头报新品，糖果类归「零食」(snacks) 子分类；供货图无净含量小字，spec 留空。
-- 只 INSERT 新行，不触碰既有分类/商品的任何列（线上与 seed 存在系统性价格漂移，禁 seed 覆盖）。
-- 幂等：INSERT OR IGNORE（账目表只跑一次；重放校验连跑两次必须不报错）。
-- 执行方式（chaoshi-web-deploy skill §4，一律走账目表）：
--   node scripts/migrate.mjs status --remote
--   node scripts/migrate.mjs apply --remote --yes
-- 前置：先全量备份并载回断言（备份只有被载回并断言过才算备份）。
-- 回滚见 rollback-add-product-laoyuannuantang.sql。
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions) VALUES ('p064', '老酸奶软糖', '', 0.5, '["snacks"]', 1, 64, '[]');
