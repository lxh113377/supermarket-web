# 07 分卷 part179 — 新增商品：正大无花果 ¥0.5（商品面变更，不占对标轮次号）

> 建卷理由：本轮是**商品面变更**（用户报新品 + 实拍供货图），不是对标轮；标题刻意不带「第N轮」，
> 以免与并行会话在途的第七十九轮争同一个轮号（P1/P2/P5 都按轮号标题取数，撞号＝两侧读数互相顶高）。

## 2026-10-24 — 新增商品：正大无花果 ¥0.5

- **目标**：上架「正大无花果」0.5 元。交付 = 真相源 `src/data/products-seed.ts` 增 1 条（order 65、
  分类 snacks、spec 留空、enabled 1）+ `db/seed.sql` 由 `node db/gen-seed.mjs` 重生成（63→64）+
  `db/migrate-add-product-zhengda-wuhuaguo.sql` 与配对回滚件（登记进
  `scripts/verify-migrate-replay.mjs` 的 `ROLLBACK_INSERT` 行集轨，`tables: ['products']`）+
  用户实拍供货图转 `public/images/65.webp`(800×800 q80) 与 `sm/65.webp`(400×400 q75)。零代码改动：
  商品 `image` 为空 ⇒ 四个调用点都走 `productImageUrl(order)` 派生 URL。
- **口径沿用**：与 2026-10-21「老酸奶软糖」（order 64）同一形状 —— 供货图无净含量小字 ⇒ spec 留空；
  散装小零食归「零食」(snacks)；线上与 seed 有系统性价格漂移 ⇒ 生产只走 `INSERT OR IGNORE` 新行，禁 seed 覆盖。
- **登记面**：`docs/governance/registry.json` 的 `facts.seedCatalog` 63→64 与 `bl-sku` evidence 同日复算；
  `docs/doc-commands.json` 由 `node scripts/check-doc-commands.mjs --update` 重生（CHANGELOG 先写后重生，顺序不可倒）。
- **本机实测**：`verify:images` 主图 65/65 + 缩略图 65/65 rc=0；`verify:migrate-replay` rc=0
  （前向迁移 7 件、回滚往返覆盖 11 件）；`verify:governance` F2 seedCatalog 腿绿；oxlint 0 警告。
- **生产变更**（chaoshi-web-deploy §4）：`d1 export` 全量备份 → 载回断言 → `migrate.mjs apply --remote --yes`
  → 线上 `/pub` 复验 p065 在列。回滚 = `db/rollback-add-product-zhengda-wuhuaguo.sql`。
