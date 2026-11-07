# 07-next-steps 逐字迁卷 — 2026-11-07 商品面变更（r103）

> 迁出原因 = 主卷按增量归档体例留指针，详细口径逐字迁本卷；主卷保持 ≤4096B（超限 CI memory-volume V2 判红）。

## 决策（Lead 自主拍板，#48/#31）
- order=70 / p070：现网 /pub 实测在售 39 条、maxOrder=69、order 70 空闲、全表 order 唯一、无重名 ⇒ 追加末位。
- name=哇哈哈营养快线：保留老大原样拼写；真实品牌娃哈哈（供货主图印娃哈哈）作为观察项，不擅自改名。
- spec=500ml / price=3.88：老大口述逐字落库。
- subcategories=[sweet]：比照 p050 优酸乳（目录里唯一含乳饮料）形态。
- image 留空走 productImageUrl(order) 派生双图，零生产代码改动。

## 素材
- 无头抓取（node:https + sharp 就地读，未开 GUI）比对 7 张候选，选定 wlkgo 正品电商主图 800×800；
  qiker 150×150 放大糊、1688 310×310、ddzgcs 多无关商品，均弃用。
- sharp 出 public/images/70.webp（800 q80 / 55222B）与 sm/70.webp（400 q75 / 15786B），
  源图留 _backup/product-images-src/wahaha-yingyangkuaixian-src.jpg（gitignore）。

## 交付链
- 真相源 products-seed.ts + gen-seed 重生成 seed.sql（68→69 行商品）。
- 成对 migrate/rollback SQL（INSERT OR IGNORE / 双条件 DELETE）+ verify-migrate-replay ROLLBACK_INSERT 登记。
- registry.json facts.seedCatalog 68→69 + evidence/measuredAt。
- 门禁 npm run verify 全链 + verify:backend && npm test；提交仅显式清单，会话前脏文件（.ci/escape-hatch.jsonl、index.html、chip-*、nul）不并入。
- 部署按 chaoshi-web-deploy skill §4：D1 迁移 status/apply（先备份载回断言）→ Pages deploy → 双发 push；
  线上复算 /pub p070 逐字段、双图 200、/_health sha、CACHE_VERSION、/web。

## 门禁收口（2026-11-07）
- V5：主卷声明 1–201 → 1–202（新建 part202 后未并号被判据拦截，修复转绿）。
- S6：judge-side-effects 册过期（16.9 天 > 14 天）⇒ CI vitest 必红阻断 deploy ⇒ `check-judge-side-effects.mjs --update`
  全量探针刷新（observed_utc=2026-11-07T13:50:00Z）⇒ vitest 31/31 复跑全过；未刷绿未改阈值。
- C9：非阻断（默认面 rc=0、脚本自注永不进阻断链）；13 条 10-29 历史未覆盖列待办，刷新需 gh api+token。
- migrate status --remote 实测：TODO 本笔迁移（sha aba67555ad0fa535）/ 19 已应用 / 1 待应用 / 共 20。
