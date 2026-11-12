# 07-next-steps 逐字迁卷 — 2026-11-13 商品面变更（r104）·（三）判据 / 回滚 / 交付清单

> 承接 `07-next-steps.part203.md` 与 `part204.md`；V4「出生即贴线」要求新卷 ≤3072B ⇒ 同轮内容按卷再分，禁压措辞。

## 判据（每条可复跑，含负控）
- 本地：npm run verify 全链 rc=0（46 段，含 verify:images 分母 seed 70 ∪ 在售 ∪ 目录、verify:migrate-replay 行集轨 8 件）；
  npm run verify:backend && npm test 全绿。
- 负控：删任一 71.webp / sm/71.webp ⇒ verify:images 判红（MIN_SIZE / WebP 魔数有牙）；迁移连跑两次不报错（A3 幂等）。
- 线上：POST /pub {action:getPublicProducts} 恰 1 条 p071 且 name/spec/price/subcategories/order/enabled 逐字段相等；
  /images/71.webp 与 /images/sm/71.webp 均 200；/_health 回 deploy == HEAD sha；/web getProducts 带密钥可见。
- 提交：git add 仅显式清单；git status 无会话前既有脏文件混入。

## 回滚
- 数据库：db/rollback-add-product-dongmai.sql（DELETE WHERE _id='p071' AND "order"=71）。
- 代码/图：git revert 本笔提交 + 删两张 webp；D1 迁移前先全量备份并载回断言（备份被载回并断言过才算备份）。

## 交付清单（本笔提交显式清单，内层 main）
DECOMPOSE.md · CHANGELOG.md · memory/07-next-steps.md · memory/07-next-steps.part203.md · src/data/products-seed.ts ·
db/seed.sql · db/migrate-add-product-dongmai.sql · db/rollback-add-product-dongmai.sql · scripts/verify-migrate-replay.mjs ·
docs/governance/registry.json · public/images/71.webp · public/images/sm/71.webp
