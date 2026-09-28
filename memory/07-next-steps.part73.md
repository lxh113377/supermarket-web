# 07 分卷 73 — 2026-09-28 对标第四十二轮整块（自主卷逐字迁出，未压措辞）

> 迁移原因：主卷 4KB 上限（`npm run verify:volume` V2/V4）。迁出=逐字复制，不是摘要；
> 轮次与卷号的对应关系仍以主卷「分卷目录」一节的 V5 双向对账为准。

## 2026-09-28 — 对标第四十二轮（cron 的"窗口内成功过"与"最近一次是红的"是两把尺）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十二轮-2026-09-28.md`；轮初锚 `4212584`。
> 本轮整块事实（含接手在途、两处自己抓自己、R42-H1/H2 收口）**逐字迁 卷 70–72**
> （一次写 6,355B 被 V2 判超限 → 续开 71；再被 V4「新卷出生即贴线 ≤3072B」判红 → 按小节边界重切成三卷，
> 全程逐字迁移不压措辞）。
> 上一轮 P0 的处置：R41-H1 已完成（远端累计用量 VERIFIED，两通道带时刻）、R41-H2 已完成一层
> （表达式目标可解引用，跨文件 import 仍推不出 ⇒ 转 R43-P0）、R41-H3 未做（同族扩散自查）。

> **P0（下一轮开工先做这条，可执行）**：**R43-P0 跨文件 import 的目标常量仍然推不出** ——
> 实测分母：`scripts/` 里 8 个含 `writeFileSync(` 的 .mjs 中 **3 个只剩 unbound**
> （`check-d1-roundtrips.mjs` 的 `WRITE_QUOTA_FILE` 来自 `import … './lib/d1-quota.mjs'`；
> `backup-crypto.mjs`/`restore-drill.mjs` 的是形参与 argv）⇒ 它们运行即改写受版本控制的产物，
> 风险表上却是零风险。择一：① **经验腿**（跑完判据后比 `git status --porcelain` 差集，脏了点名）；
> ② 解析 import 再解引用（`argv` 那一类仍解不出）。**禁**为让本仓变绿而放宽 `writes-artifacts`。
> **R43-H1** `check-backup-liveness.mjs` 的 presence 模式把 OK 行印成"最近一次可核对备份"是假的
> （该模式不要求产物）⇒ 输出与 mode 对齐，并配"presence 模式不得出现'备份'字样"的断言。
> **R43-H2** 同族扩散自查（承 R41-H3，仍欠）：把"声明面 ⇄ 采集面分离"在其它多前缀判据里逐条列分母。
> 用户侧不变：**`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺** ⇒ 备份链 `artifact=0`，
> 本轮起记为**具名限期豁免至 2026-10-12**（`docs/cron-health.json`，到期自动重新判红）；
> M3 分支保护未重跑；微信真机验收未做。
> 用户侧不变：**M3 分支保护本轮未重跑 ⇒ 记未验证**（承 09-27 13:16:35Z 读数不许抄）；
> `BACKUP_PASSPHRASE` + `CF_D1_BACKUP_TOKEN` 仍缺 ⇒ 备份链 `artifact=0`。
