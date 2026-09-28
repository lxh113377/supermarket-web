# 卷 72 — 对标第四十二轮续（V4「新卷出生即贴线」判红后续开，逐字迁移未压措辞）

## R43 P0（下一轮开工先做这条，可执行）

**R43-P0 跨文件 import 的目标常量仍然推不出**（本轮一手，分母已数）：`scripts/` 里 8 个含
`writeFileSync(` 的 .mjs 中 **3 个只剩 unbound** —— `check-d1-roundtrips.mjs` 的 `WRITE_QUOTA_FILE`
来自 `import … from './lib/d1-quota.mjs'`，`backup-crypto.mjs` / `restore-drill.mjs` 的是形参与 argv。
判据侧现状：这类文件在风险表上是"零风险"，但它们运行即改写受版本控制的产物。
两条出路（择一，禁为变绿放宽）：① **经验腿**：跑完判据后核对工作树是否变脏（`git status --porcelain` 差集），
脏了就点名；② 解析 import 再解引用（成本更高，且 `argv` 那一类仍解不出）。
**R43-H1** `check-backup-liveness.mjs` 的 presence 模式措辞："最近一次可核对备份"在该模式下是假的
（它不要求产物）⇒ 改判据自己的输出与其 mode 一致，并配"presence 模式不得出现'备份'字样"的断言。
**R43-H2** `event=schedule` 徽章只有人读 README 时才起作用 ⇒ 若要机器认，需把徽章 URL 与
`docs/cron-health.json` 的条目对账（现在没有这条判据，别把"挂了徽章"当成"有人在看"）。
用户侧不变：`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺 ⇒ 备份链 `artifact=0`（本轮起
`check-cron-health` 把它记成**具名限期豁免至 2026-10-12**，到期自动重新判红）；M3 分支保护未重跑；微信真机验收未做。
