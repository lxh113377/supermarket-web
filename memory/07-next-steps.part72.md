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

**R43-H4 同名文件竞争（本轮一手，属"没查过就等于没发生"的反面）**：本轮按 V4 机械重切卷时，
对端会话正把它的第四十二轮笔记写进**同一个文件名** `07-next-steps.part70.md`（其内容当时未提交）。
实测现状：`git show --name-only 20cfeda d9f522d` 里都没有 part70 ⇒ 对端那版笔记在我重切时被覆盖，
其**实质内容**在其已提交的 CHANGELOG「五十六」条目里有等价记录（`grep -c 口味 CHANGELOG.md` = 47），
所以不是数据事故，但**署名与在途状态**丢了。三条处置：
① 下轮开工先 `git log -1 --format='%h %cI %s' -- memory/07-next-steps.part70.md` 看最后落笔的是谁；
② 用对端本轮刚交付的 `node scripts/session-worktree.mjs add <名字>` 各开一棵工作树
   （每树独立 index，物理上消除"我 add 带走你的在途"）；
③ 新建共享文件前必须 `ls` + 独占创建（本仓已因此立过一次 `ci_fix_hint.py` 双造）。
