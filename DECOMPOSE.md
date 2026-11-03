# DECOMPOSE — 2026-11-03 康师傅茉莉柚茶新品（r102）

> 目标（goal-9a399fce rev 1）：添加新商品「康师傅茉莉柚茶1L 3.88元」，供货图已由老大提供。
> 先例 = r101 香芋压片糖（order 68，24ae9b9）同链执行。**本轮已全部交付并线上复算通过。**

## 分解与回收（两件并行派发 + Lead 自留实施/门禁/部署）
| # | 件 | 归属 | 结果 |
|---|----|------|------|
| A | 本地证据件（images 派生链 / verify_images 分母 / 测试断言面 / specOptions 口径） | 子代理 | ⚠️ 只回骨架（A.md 407B 六节全待填），与 r101 件A 同病；缺项由 Lead 自测补齐（variants.test.ts:308 KEEP 清单不受影响、4 套 135 例实跑全过），未重派 |
| B | 部署权威命令序列 | 子代理 | ⚠️ 收件时 B.md 未落盘；命令序列改由 Lead 按 chaoshi-web-deploy §4 + r101 logs 直出，未阻塞 |
| C | 实改：69.webp + sm/69.webp（sharp 800w q80 / 400w q75）+ seed 行 + 迁移/回滚 SQL + 回滚登记 | Lead | ✅ |
| D | 本地门禁 | Lead | ✅ npm run verify 全链 rc=0（46 段；governance 12/0、replay 行集轨 6 件含新件、images 69/69 分母含 69） |
| E | 部署 + 线上复算 + 提交 + push | Lead | ✅ 备份载回断言 rc=0（2,485,896B/1805 行/14 表/products=68）→ 迁移 APPLIED → Pages 部署 → /pub p069 逐字段对 + 双图 200 |

## 关键事实（Lead 实测）
- 源图 = 桌面 7abe74ae….jpg（800×800 JPEG，与对话附件同图）；线上 products=68/maxOrder=68 ⇒ 新品 p069/order 69。
- 归类比照 53/54 茉莉清茶/蜜茶：spec='1L'（图上净含量小字）、subcategories=["tea","sweet"]。
- **判据自修（非放宽）**：首版 /pub 判据写「total=69」被实测打脸——线上在售=43 是商家既有下架状态
  （53/54 线上 enabled=0 早于本笔，remote enabledTotal=43 复算证实），本笔不碰既有行 ⇒ 判据改为
  「p069 恰 1 条且 name/spec/price/order/enabled 逐字段相等」→ PUB_CHECK_PASS。负控：迁移重放幂等由
  verify:migrate-replay A3 两次重放机制背书（行集轨 INSERT OR IGNORE）。

## 交付清单（本笔提交）
- db/migrate-add-product-moliyoucha.sql + rollback（_id+order 双条件删行，已登记 ROLLBACK_INSERT 行集轨）
- src/data/products-seed.ts（order 69 一行）/ db/seed.sql（gen-seed 重生成 68 行）
- public/images/69.webp + sm/69.webp（源图留 _backup/product-images-src/moliyoucha-src.jpg）
- scripts/verify-migrate-replay.mjs（回滚件登记）/ docs/governance/registry.json（seedCatalog 67→68 + evidence）
- CHANGELOG.md（2026-11-03 节）/ memory/07-next-steps.md（台账）
