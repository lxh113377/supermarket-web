-- 新增商品：脉动维生素饮料 600ml ¥3.88（2026-11-13，order 71）
-- 背景：老大当轮给供货图 + 口述「脉动600ml 3.88元」；供货图 = 脉动维生素饮料 青柠口味 600ml*15瓶（整箱装广告图），
--   图上净含量小字 = 600ml ⇒ spec 带上；图上卖点「3D源动力 / 多种维生素」⇒ 归类比照目录里维生素面的
--   p014「水溶c100」与 p015「维他命」：subcategories ['vitamin']（不归茶/甜口/提神）。
-- 只 INSERT 新行，不触碰既有分类/商品的任何列（线上与 seed 存在系统性价格漂移，禁 seed 覆盖）。
-- 幂等口径（本笔改了形状，理由是一手的）：判据从 `_id` 改成 `"order"` 存在性守卫 ——
--   本机 CF 凭据只有 D1 读权限，写面只能走 Pages Functions 的 /web createProduct，而那条通道会生成
--   `p_<ts><rand>` 形态的 _id。若仍按 `_id='p071'` 幂等，日后有人用足权限跑本件会**再插一行同 order 的**
--   商品（order 71 出现两条）。故以本仓真正唯一的业务键 `"order"` 做存在性守卫：
--   无论那行是先由 API 建的还是由本件插的，重放都是 no-op。
-- 图片走派生 URL：商品 image 为空 ⇒ 前端按 src/utils/images.ts 的 productImageUrl(order) 取 /images/71.webp，
--   零代码改动；配套资产 public/images/71.webp（800w q80）与 public/images/sm/71.webp（400w q75）同笔入库。
-- 执行方式（chaoshi-web-deploy skill §4，一律走账目表）：
--   node scripts/migrate.mjs status --remote
--   node scripts/migrate.mjs apply --remote --yes
-- 前置：先全量备份并载回断言（备份只有被载回并断言过才算备份）。
-- 回滚见 rollback-add-product-dongmai.sql（按 "order" + name 双条件删本行）。
INSERT OR IGNORE INTO products (_id, name, spec, price, subcategories, enabled, "order", specOptions)
SELECT 'p071', '脉动', '600ml', 3.88, '["vitamin"]', 1, 71, '[]'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE "order" = 71);
