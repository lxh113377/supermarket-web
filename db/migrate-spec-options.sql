-- 可选规格（口味）迁移（2026-09-25）
-- specOptions = JSON 数组 [{"label":"黄瓜味","enabled":true}]；缺省 enabled 视为开启，
-- 后台把某口味关掉只写 enabled:false，顾客端因此不再渲染该口味（数据保留，随时可再开）。
-- 执行方式（chaoshi-web-deploy skill）：node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --file=db/migrate-spec-options.sql --remote
-- ⚠️ 顺序铁律：先跑本迁移、再部署引用 specOptions 列的代码（否则线上 SELECT 报 no such column）。
-- ⚠️ ALTER 不可重复执行，重跑前先确认列已存在；后面的 UPDATE 都是幂等的。
ALTER TABLE products ADD COLUMN specOptions TEXT DEFAULT '[]';

-- 四款小包薯片的可选口味（2026-09-25 网查在售包装标注：京东 / 什么值得买 / 百度知道）。
-- 同一小包共用单价与实拍图，选口味不改价；店里没进的口味由商家在管理后台关掉。
UPDATE products SET specOptions = '[{"label":"原味"},{"label":"黄瓜味"},{"label":"青柠味"},{"label":"番茄味"},{"label":"墨西哥鸡汁番茄味"},{"label":"意大利香浓红烩味"},{"label":"得克萨斯烧烤味"},{"label":"烤虾味"}]', updatedAt = CURRENT_TIMESTAMP WHERE "order" = 33;
UPDATE products SET specOptions = '[{"label":"里脊牛排味"},{"label":"芝士培根味"},{"label":"番茄酱味"},{"label":"滋香烤鸡味"},{"label":"麻辣小龙虾味"}]', updatedAt = CURRENT_TIMESTAMP WHERE "order" = 34;
UPDATE products SET specOptions = '[{"label":"韩国泡菜味"},{"label":"多汁牛排味"},{"label":"蜂蜜黄油味"},{"label":"加勒比烤翅味"},{"label":"火鸡面味"},{"label":"见手青味"},{"label":"香菜塔可味"}]', updatedAt = CURRENT_TIMESTAMP WHERE "order" = 40;
UPDATE products SET specOptions = '[{"label":"海苔味"},{"label":"芥末味"},{"label":"鸡肉味"},{"label":"烧烤味"},{"label":"番茄味"},{"label":"泡菜味"},{"label":"咖喱牛肉味"},{"label":"香洋葱味"}]', updatedAt = CURRENT_TIMESTAMP WHERE "order" = 52;

-- 其余商品（含全部饮品）一律清空：本轮口径是「只保留 4 款小包薯片 + 白象方便面的可选规格」，
-- 白象的帮泡/零售由前端跨记录聚合层提供（src/data/variants-demo.ts），不走本列。
UPDATE products SET specOptions = '[]', updatedAt = CURRENT_TIMESTAMP WHERE "order" NOT IN (33, 34, 40, 52);
