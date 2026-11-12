# DECOMPOSE — 2026-11-13 脉动新品（r104）

> 目标（goal-fc2e2405 rev 1）：新增商品「脉动600ml 3.88元」。
> 先例 = r103 哇哈哈营养快线（order 70，c9c0807 / d89ddab）同链执行。本卡为 #44 ① 分解卡 / D20 骨架落盘。
> 结论进权威件（DECOMPOSE / registry / 迁移门禁）⇒ 开工已并行派 2 件（只读变更面测绘 + 商品图生产），收件后 Lead 自留实施。

## 决策（Lead 自主拍板，#48/#31 零回抛；P0.19 用户指令高于一切）
- order=71 / _id=p071：现网 getCatalogOrders 全集 70 条、maxOrder=70、**无跳号**、71 空闲、无重名 ⇒ 追加末位不撞号。
- name=脉动：老大原话「脉动600ml」；不写「脉动维生素饮料」全称 —— 目录既有命名风格都是短名（茶π / 维他命 / 水溶c100），
  且商品卡上若再叠广告图里的长标题会重复拥挤（图片子代理目检结论同向）。
- spec=600ml / price=3.88：老大口述逐字；供货图图上净含量小字 600ml 与口述一致（旁证，不改口径）。
- subcategories=['vitamin']：图上卖点「3D源动力 / 多种维生素」；比照 p014 水溶c100 / p015 维他命。不是茶、不是含乳甜饮、
  也不是功能提神能量饮料 ⇒ 不选 tea/sweet/energy。
- 图片：老大本轮附件（Desktop/dd90d0d5….jpg，800×800 JPEG 138315B）直接作商品图，**不找网图、不 AI 生图**；
  sharp 出 800 q80 / 400 q75 双尺寸，只下采不放大；源图归档 _backup/product-images-src/（gitignore）。

## 写面分工
| 面 | 文件 | 谁 | 状态 |
|---|---|---|---|
| 真相源 | src/data/products-seed.ts | Lead | ✅ order 71 |
| 种子库 | db/seed.sql | Lead | ✅ gen-seed 重生成 70 行 |
| 生产库 | db/migrate-add-product-dongmai.sql + rollback | Lead | ✅ 行集轨 / 双条件 DELETE |
| 门禁登记 | scripts/verify-migrate-replay.mjs ROLLBACK_INSERT | Lead | ✅ 具名 +1 行 |
| 治理册 | docs/governance/registry.json facts.seedCatalog 69→70 + measuredAt | Lead | ✅ |
| 图片 | public/images/71.webp + sm/71.webp | 子代理 | ✅ 104860B / 31826B |
| 台账 | CHANGELOG.md / memory 三卷（203/204/205）/ DECOMPOSE.md | Lead | ✅ |
| 变更面测绘 | _incoming/r104-evidence/A.md | 子代理 | 见收件 |
| 会话前既有脏文件（#40 禁并入） | .ci/escape-hatch.jsonl / index.html / chip-crop-meta.json / chip-shot.png / nul | — | 明确排除 |

## 判据（每条可复跑，含负控）
- 本地：npm run verify 全链 rc=0（46 段）；verify:backend rc=0；npm test 全绿。
- 定向：verify:images「主图 71/71 + 缩略图 71/71 全部有效（面=seed 70 ∪ 在售 ∪ 目录）」；verify:migrate-replay 行集轨 8 件覆盖；
  verify:governance F2 facts 比对 13 组 / 不符 0；verify:registry 6/6；verify:changelog 有吻合条目；verify:volume GATE-PASS。
- 负控：删任一 71.webp / sm/71.webp ⇒ verify:images 判红；迁移连跑两次不报错（A3 幂等）。
- 线上：/pub getPublicProducts 含 p071 且逐字段相等；/images/71.webp 与 sm/71.webp 均 200；/_health deploy == HEAD sha。

## 回滚
- 数据库：db/rollback-add-product-dongmai.sql（DELETE WHERE _id='p071' AND "order"=71）。
- 代码/图：git revert 本笔提交 + 删两张 webp。迁移前先全量备份并载回断言（备份只有被载回并断言过才算备份）。

## 环境实测（本轮开工读数，决定部署路线）
- wrangler OAuth 登录态**已过期**（whoami: Not logged in / token expired）。`.dev.vars` 的 CF_D1_BACKUP_TOKEN 有效但权限只到 D1：
  `d1 execute --remote` 读写 PASS（SELECT 70 行 / 空靶 DELETE changes=0）；`pages project list`、`pages deploy` 均报 Authentication error 10000
  ⇒ **本机无法自行 Pages 部署**，部署只能走 push main → CI deploy job。
- GitHub：api.github.com 直连 200，gh CLI 已登录（lxh113377，repo + workflow scope）；git 走 Clash 127.0.0.1:7897
  （首轮 `git ls-remote` RPC 失败，重试 PASS）。
