# 07 分卷 part199 — 2026-11-01 商品面变更（香芋压片糖 + 白象五口味 + 泡面换图）

> 非对标轮、不占轮号（同 part179/198 口径）。主卷只留指针。

## 变更内容

- 新增 order 68「香芋压片糖」¥0.5（snacks，spec 留空：供货图无净含量小字）。
- 白象五口味 = 红烧 / 香辣 / 排骨 / 肥牛 / 椒香；**46 帮泡与 47 零售都可选口味**（老大原话），
  两条共用 seed 内同一份 `BIXIANG_FLAVORS` 常量 ⇒ 不会出现「帮泡有椒香而零售没有」的漂移。
- 46/47 图片全部替换为「白象五口味全家福」（1280 源图下采 800w q80 + sm 400w q75）；
  68 用香芋糖供货图同流水线。旧 46/47 图留在 `_backup/product-images-src/replaced-4{6,7}-old.webp`。

## 迁移与登记面

- 三件新迁移 + 三件配对回滚：`migrate-add-product-xiangyu-yapian.sql`（行集轨）、
  `migrate-taste-baixiang5-p046.sql` / `-p047.sql`（数据轨，单列 UPDATE）。
  三个回滚件已登记进 `scripts/verify-migrate-replay.mjs`（ROLLBACK_INSERT +1、ROLLBACK_DATA +2）。
- 排序实测：`migrate-taste-baixiang.sql` < `migrate-taste-baixiang5-p046.sql` < `-p047.sql`，
  且都在 `migrate-spec-options.sql`（末行 NOT IN 清空）之后 ⇒ 从零重放收敛到五口味。
- `docs/governance/registry.json`：`facts.seedCatalog` 66→67、`bl-sku` evidence 同日复算。
- 顺带治一处日历型红：`docs/d1-remote-usage.json` 回执 @2026-10-24 已超 7 天 ⇒ A11 判红；
  跑 `node scripts/check-d1-remote-usage.mjs --write` 刷新（VERIFIED @2026-11-01T13:57Z）并**同笔**同步
  registry 的 `d1Usage` 三项（68 / 4643 / 2026-11-01）—— 该件头注警告过的"只写回执不跟册"正是上一轮实测坑。

## 本机实测（改前基线 HEAD=d429d11，线上 /pub 实测 p046=2.88 旧三口味 / p047=1.68 无口味）

- `verify:migrate-replay` rc=0（前向 11 件幂等重放 + 回滚往返结构 6 / 数据 4 / 行集 5 = 覆盖 15 件）
- `verify:images` rc=0：主图 68/68 + 缩略图 68/68，覆盖率 100%，孤儿 0
- `verify:governance` 12/0 PASS（F2 facts 13 组逐键相等）
- `check:d1-roundtrips` 25/0（A11 转绿）
- `check:changelog` rc=0；`check:doc-commands --update` 后 rc=0（提及 396 / claim 381 / 不成立 0）
- `lint` 0 警告 0 错误（433 文件）；`tsc --noEmit` rc=0；`vite build` rc=0
- `npx vitest run` 定向复跑 3 个改动测试文件：100/100 通过

## 生产变更（待本笔收尾执行，回执补在下方）

- 备份：`wrangler d1 export supermarket --remote` + `BACKUP_SQL=… node scripts/verify-backup-restore.mjs` 载回断言
- 迁移：`node scripts/migrate.mjs status --remote` → `apply --remote --yes`
- 部署：`wrangler pages deploy dist --project-name=supermarket-web` + `git push origin main`（顾客端 dispatch 双发）
- 线上复算：`/_health` deploy==HEAD；`/pub` 读 p046/p047 specOptions 五口味、p068 在列
