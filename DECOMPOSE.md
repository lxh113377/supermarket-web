# DECOMPOSE — 2026-11-07 哇哈哈营养快线新品（r103）

> 目标（goal-397c9d99 rev 1）：加入新商品「哇哈哈营养快线500ml 3.88元」。
> 先例 = r102 康师傅茉莉柚茶（order 69，89135ee）同链执行。本卡为 #44 ① 分解卡 / D20 骨架落盘。
> 结论进权威件（DECOMPOSE / registry / 迁移门禁）⇒ 已先并行派 3 件只读取证（现网面 / 配方面 / 部署契约面），收件后 Lead 自留实施。

## 决策（Lead 自主拍板，#48/#31 零回抛；P0.19 用户指令高于一切）
- order=70 / _id=p070：现网 /pub getPublicProducts 实测在售 39 条、maxOrder=69、order 70 空闲、全表 order 唯一、无重名 ⇒ 追加末位不撞号。
- name=哇哈哈营养快线：保留老大原样拼写；真实品牌为娃哈哈（供货主图印娃哈哈），作为观察项记录，不擅自改名。
- spec=500ml / price=3.88：老大口述净含量与售价逐字落库。
- subcategories=[sweet]：比照目录里唯一含乳饮料 p050 优酸乳的归类；含乳甜饮不归茶/维生素。
- image 留空：调用点走 productImageUrl(order) 派生 /images/70.webp 与 /images/sm/70.webp，零生产代码改动。
- 素材：无头抓取选定正品电商主图（wlkgo 800×800），sharp 出 800 q80 / 400 q75 双尺寸，源图留 _backup/product-images-src/（gitignore）。

## 写面分工（Lead 单干；无并行写面冲突，结论件由 Lead 自留）
| 面 | 文件 | 状态 |
|---|---|---|
| 真相源 | src/data/products-seed.ts | ✅ 末行追加 order 70 |
| 种子库 | db/seed.sql | ✅ node db/gen-seed.mjs 重生成（68→69 行商品） |
| 生产库 | db/migrate-add-product-wahaha-yingyangkuaixian.sql + rollback 配对 | ✅ 行集轨 INSERT OR IGNORE / 双条件 DELETE |
| 门禁登记 | scripts/verify-migrate-replay.mjs ROLLBACK_INSERT | ✅ 具名登记 |
| 治理册 | docs/governance/registry.json facts.seedCatalog 68→69 + evidence/measuredAt | ✅ |
| 图片 | public/images/70.webp + public/images/sm/70.webp | ✅ 55222B / 15786B 真 WebP |
| 台账 | CHANGELOG.md / memory/07-next-steps.md / 07-next-steps.part202.md / DECOMPOSE.md | ✅ |
| 会话前既有脏文件（#40 禁并入） | .ci/escape-hatch.jsonl / index.html / chip-crop-meta.json / chip-shot.png / nul | 明确排除 |

## 判据（每条可复跑，含负控）
- 本地：npm run verify 全链 rc=0（46 段，含 verify:images 分母含 70、verify:migrate-replay 行集轨覆盖新件）；npm run verify:backend && npm test 全绿。
- 负控：删任一 70.webp/sm/70.webp ⇒ verify:images 判红（MIN_SIZE/WebP 魔数有牙，非恒绿）；迁移连跑两次不报错（A3 幂等）。
- 线上：/pub getPublicProducts 恰 1 条 p070 且 name/spec/price/subcategories/order/enabled 逐字段相等；/images/70.webp 与 /images/sm/70.webp 均 200；/_health 回 deploy==HEAD sha；/web getProducts 可见；CACHE_VERSION 指纹换新。
- 提交：git add 仅显式清单；git status 无会话前既有脏文件混入。

## 回滚
- 数据库：db/rollback-add-product-wahaha-yingyangkuaixian.sql（DELETE WHERE _id=p070 AND order=70）。
- 代码/图：git revert 本笔提交 + 删两张 webp；D1 迁移前先全量备份并载回断言（备份被载回并断言过才算备份）。
- 部署前留文件级回退点；错值拒、CORS、github.io 200 逐项复算。

## 交付清单（本笔提交显式清单，内层 main）
DECOMPOSE.md · CHANGELOG.md · memory/07-next-steps.md · memory/07-next-steps.part202.md · src/data/products-seed.ts · db/seed.sql · db/migrate-add-product-wahaha-yingyangkuaixian.sql · db/rollback-add-product-wahaha-yingyangkuaixian.sql · scripts/verify-migrate-replay.mjs · docs/governance/registry.json · public/images/70.webp · public/images/sm/70.webp

## 状态（r103 收口回执，2026-11-07）
- 门禁：npm run verify + verify:backend + npm test 全链 CHAIN_RC 0/0/0（GATE-PASS 17；S6 读数由全量探针刷新、doccmd 台账重生、C9 实证非阻断）。
- 提交：c9c0807（14 件显式清单）；D1：备份 2502467B 载回断言 OK（1866 行/14 表/products=69）→ APPLIED 1 新应用 → 负控重放 0 待应用。
- 部署：本地 pages deploy 6c033a25 + push（HTTP/1.1 去代理，064ce6a..c9c0807）→ CI run 42380538366/42380538252 @c9c0807 success；dispatch run 42380546680 success（github.io 重建）。
- 线上：/_health deploy=c9c0807==HEAD（live-shape 3/3 漂移 0）；CACHE_VERSION sm-v1794060935787；/pub 在售 40 条 p070 恰 1 条逐字段相等；双图 200；smoke 4/4（含 /web 带密钥）；uptime 管理侧全绿+密钥禁令在守，顾客端 3 红+打印反代 530 = r102 在册既有红非本笔引入。
- 遗留待办：C9 读数刷新（联网 gh api）与顾客端巡检红修复 → 07-next-steps.part202.md。

## 门禁收口记录（2026-11-07 实测）
- 首跑全链（npm run verify && verify:backend && npm test，日志 _backup/verify-r103.log）：CHAIN_RC verify=1 backend=0 test=1。
- V5 一次修复（真判据拦截）：新建 07-next-steps.part202.md 但主卷声明仍 1–201 ⇒ 改 1–202 后 memory-volume GATE-PASS。
- S6 证据新鲜度修复（阻断性）：docs/judge-side-effects.json observed_utc=2026-10-21 距今 16.9 天 > 14 天 ⇒ CI gates 的
  vitest 必红（ci.yml:142）⇒ deploy needs 掐死。按判据自带救济跑 `node scripts/check-judge-side-effects.mjs --update`
  全量探针（候选 23 / 盲 15 / 实测产物 5）重算读数（observed_utc=2026-11-07T13:50:00Z，rc=2 UNVERIFIED 仅因刷新当轮
  S6 先读旧值；册已落盘）⇒ npx vitest run tests/judgeSideEffects.test.js 复跑 31/31 全过。未刷绿、未改阈值、未删用例。
- C9 阻断性判定（非阻断）：verify:escape-hatch 默认面 ESCAPE_RC=0（verdict GREEN rc=0），C9 FAIL 文案只是打印，
  check-escape-hatch-log.mjs:478 return r.rc 不升 rc，CI 不带 --require-covered；13 条未覆盖是 10-29 历史 commit
  （dc8eed52e5/143c5ff5ac/cf44ce5828/5deae5575b/a56e8c115e/ecfd85e390 等），刷新需 gh api 联网+token，列后续待办不挡部署。

