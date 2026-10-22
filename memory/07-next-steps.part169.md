> 建卷理由（数字实测）：本条是「新增商品 + 同轮 CI 排障」的记录，主卷 `memory/07-next-steps.md` 与
> `part168.md` 都被并行会话占着写（工作区 M 状态），按 V3「新卷 ≤3072B、不压他人措辞」立新卷。

## 2026-10-22 — 第七十七轮（新增商品：老酸奶软糖 ¥0.5 + CI 排障八连）

- **目标**：添加新商品「老酸奶软糖」0.5 元。交付 = 真相源 `src/data/products-seed.ts` 增 1 条（order 64、
  分类 snacks、spec 留空、enabled 1）+ `db/seed.sql` 由 `node db/gen-seed.mjs` 重生成（62→63）+
  `db/migrate-add-product-laoyuannuantang.sql` 与配对回滚件（登记进
  `scripts/verify-migrate-replay.mjs` 的 `ROLLBACK_INSERT`，`tables: ['products']`）+
  自绘示意图 `public/images/64.webp`(800w) 与 `sm/64.webp`(400w)（用户未提供供货图，图内带「示意图」水印）。
- **生产变更**（按 `chaoshi-web-deploy` skill §4）：先 `d1 export` 全量备份
  `_backup/d1-pre-2026-10-21-laoyuannuantang.sql`（2.30MB，本地载回断言 products=63/enabled=31/orders=102）
  → `migrate.mjs apply --remote --yes`（1 新应用）→ `wrangler pages deploy dist`。
  线上复验：`/pub` 31 条含 `p064`（enabled=true、price=0.5）、管理端 64 条在列、两图均 `200 image/webp`、smoke 四项全 PASS。
- **本机 git/curl 到 github.com 一律 TLS EOF**（Clash 未通 + schannel），`node fetch` 正常 ⇒ 全程走
  **Git Data API 增量推送**（比对远端树 ⇄ 本地 HEAD，只传差异 blob）。连修 8 处 CI 红，三处是判据自身缺陷：
  ① 第76轮一整批文件漏提交（package.json 别名 / README 行 / 两脚本导出与自声明 / governance 六件）
     ⇒ 判据 import 未入库导出，CI 上即失败而本机全绿（head-closure H2 要禁的那件事）；
  ② governance 判据把运行时读数写进册 + 外层不可得输出 null + 测试不接受 rc=2；
  ③ judge-side-effects S7 把「D1 读数随时间变」判成「生成器不幂等」。
- **一次自伤（记牢）**：API 增量推送若取**工作区**字节而非 git 索引版，会把并行会话未提交的改动推上远端
  （本轮把「打印页替换」章节推上去一次，触发 verify:eol 判红，已用 revert commit 把三个 path 指回 HEAD blob 修回）。
  正解：diff 基线用 `git ls-tree`/`rev-parse HEAD:<path>` 取**索引版** sha，上传后校验 `sha === 本地 blob sha`。
- **最终读数**：CI（head `550b2a8`）六 job 全 success；`/_health` 回 `deploy=550b2a8`、`db=ok`；
  `Release parity` / `Dispatch deploy` 均 success；本机 vitest 137 文件 2031 用例全过、lint 0、verify:backend 204/0。
- **下一轮 P0**：把「API 推送前必须校验 blob sha === git 索引 sha」写进 `chaoshi-web-deploy` skill 的坑表
  （本轮两次差点推错内容，根因同一处）。

> **2026-10-22 更正（同卷追加，不改上文）**：本卷「自绘示意图 + 水印」那条已被取代——
> 用户随后补来实拍供货图，已覆盖 `public/images/64.webp` 与 `sm/64.webp`（`verify:images` 63/63 rc=0）。
> 教训：**用户报新品时先问一句有没有供货图**，占位图只是兜底，不是终态。
