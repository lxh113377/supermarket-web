-- 新增第三个板块「日用」+ 4 个商品（2026-10-07）
-- 背景：原有饮品/食品两个板块，「日用」为第三个；子分类取单个「日用百货」(daily_goods)。
--       4 件商品：纸帕 0.1 / 纸抽 0.5 / 一次性碗盖筷 0.5 / 一次性垃圾袋 0.5。
-- 只 INSERT 新行，不触碰既有分类/商品的任何列（线上与 seed 存在系统性价格漂移，禁 seed 覆盖）。
-- 幂等：INSERT OR IGNORE（账目表只跑一次；重放校验连跑两次必须不报错）。
-- 执行方式（chaoshi-web-deploy skill §4，一律走账目表）：
--   node scripts/migrate.mjs status --remote
--   node scripts/migrate.mjs apply --remote --yes
-- 前置：先全量备份并载回断言（备份只有被载回并断言过才算备份）。
-- 回滚见 rollback-daily-goods.sql。
INSERT OR IGNORE INTO categories (_id, name, type, "order", subcategories) VALUES ('daily', '日用', 'daily', 3, '[{"id":"daily_goods","name":"日用百货","order":1}]');
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions) VALUES ('p060', '纸帕', '', 0.1, '["daily_goods"]', 1, 60, '[]');
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions) VALUES ('p061', '纸抽', '', 0.5, '["daily_goods"]', 1, 61, '[]');
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions) VALUES ('p062', '一次性碗盖筷', '', 0.5, '["daily_goods"]', 1, 62, '[]');
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions) VALUES ('p063', '一次性垃圾袋', '', 0.5, '["daily_goods"]', 1, 63, '[]');
