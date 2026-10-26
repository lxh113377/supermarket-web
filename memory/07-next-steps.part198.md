# 07 分卷 part198 — 新增商品：小样软糖 ¥0.49、话梅糖软糖 ¥0.09（商品面变更，不占轮次号）

> 建卷理由：本轮是**商品面变更**（用户报两件新品 + 供货图），不是对标轮；标题刻意不带「第N轮」，
> 与既有商品面变更卷（part179/part180）同形，不与并行会话在途轮次争号。

## 2026-10-26 — 新增商品：小样软糖 ¥0.49、话梅糖软糖 ¥0.09

- **目标**：上架两件糖果。交付 = 真相源 `src/data/products-seed.ts` 增 2 条（order 66/67、分类 snacks、
  spec 留空、enabled 1）+ `db/seed.sql` 由 `node db/gen-seed.mjs` 重生成（64→66）+
  `db/migrate-add-product-xiaoyang-huamei.sql` 与配对回滚件（登记进
  `scripts/verify-migrate-replay.mjs` 的 `ROLLBACK_INSERT` 行集轨，`tables: ['products']`）+
  供货图转 `public/images/66.webp`(800×800 q80)、`sm/66.webp`(400×400 q75)、`67.webp`、`sm/67.webp`。
  零代码改动：商品 `image` 为空 ⇒ 四个调用点都走 `productImageUrl(order)` 派生 URL。
- **口径沿用**：与 2026-10-24「正大无花果」（order 65）同一形状 —— 供货图无净含量小字 ⇒ spec 留空；
  糖果类归「零食」(snacks)；线上与 seed 有系统性价格漂移 ⇒ 生产只走 `INSERT OR IGNORE` 新行，禁 seed 覆盖。
  两件合一个迁移件（同日同批上架，回滚也整批走）。
- **图片源**：小样软糖 = 好采头「小样」酸Q糖整盒陈列图（1200×1200）；话梅糖软糖 = 话梅味软糖
  白瓷碗实拍（800×800）。原图归档 `_backup/product-images-src/`（gitignore 面，仅溯源用）。
- **登记面**：`docs/governance/registry.json` 的 `facts.seedCatalog` 64→66 与 `bl-sku` evidence 同日复算；
  `docs/doc-commands.json` 由 `node scripts/check-doc-commands.mjs --update` 重生（CHANGELOG 先写后重生，顺序不可倒）。
- **生产变更**（chaoshi-web-deploy §4）：`d1 export` 全量备份 → 载回断言 → `migrate.mjs apply --remote --yes`
  → 线上 /pub 复验 p066/p067 在列。回滚 = `db/rollback-add-product-xiaoyang-huamei.sql`。
