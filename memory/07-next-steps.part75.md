# 07 分卷 75 — 2026-09-28 对标第四十四轮整块（自主卷逐字迁出，未压措辞）

> 迁移原因：主卷 4KB 上限（`npm run verify:volume` V2/V4）。迁出=逐字复制，不是摘要。

## 2026-09-28 — 对标第四十四轮（判据自己的词法器有一条分支从来没生效过）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十四轮-2026-09-28.md`（执行段为第四十四轮）；
> 轮初锚 `eb3b1be`。上一轮 P0 的处置：**R43-P0 已完成**（经验腿：`check-judge-side-effects.mjs` 真跑两趟
> + sha/mtime 两把尺，候选 9／盲件 3／实测改写面 3，一手缺口 `check-d1-roundtrips --update-write-quota`
> 已并入风险表）；**R43-H1 由并行会话作出**（`check-backup-liveness` 的 mode 措辞，未并入本提交）；
> **R43-H2 仍未做**。一手细节（四条修复 + 两次并发事故）逐字见**卷 74**；第四十二轮整块见**卷 73**。
> 新在册：`check:doc-commands`（文档命令 ⇄ 别名/盘上文件 ⇄ README 生成表，D1~D6，真面 123 条提及 0 不成立）
> 与 `check:judge-side-effects`（CI 走 `--blind-only`，76s）两道闸已进链。

> **P0（下一轮开工先做这条，可执行）**：**R45-H1 把 `writes-artifacts` 的"实测面"接进探针分母的决策写死** ——
> 现在风险标签是「静态 ∪ 实测」两源合成（`check-cli-entrypoints.mjs` 的 `empiricalWriters()`），
> 但**没有判据核对"册子的读数是哪一轮跑出来的"**：`docs/judge-side-effects.json.observed_utc` 目前
> `2026-09-28T…Z`，若某轮改了写盘代码而不重跑探针，标签就悄悄过期。取数面：`grep -n "observed_utc" scripts/*.mjs`
> （本轮实测该字段只有生产者写、无人判 ⇒ 择一：给 S 系列加"册龄 > N 天判 WARN"，或在 CI 的 `--blind-only`
> 步之后断言 observed_utc 已更新）。**禁**用"CI 每次都跑"充当证据——CI 跑的是缩面。
> **R45-H2 R43-H2 遗留（同族扩散自查）**：本轮已抓到两例"声明面 ⇄ 采集面分离"（词法器、写开关子串），
> 仍欠一张表：把仓内每条"多前缀/多来源派生分母"的判据各出一行分母（候选：`check-limit-provenance`
> 的 `SURFACE_PREFIXES`、`check-registry-sync` 的三张表、`check-error-semantics` 的出口集）。
> **R45-H3 体积闸读到撕裂写**：卷 74 记录的第一次 `verify:volume` 假红 ⇒ 门禁是否该对"读到的字节数"
> 做二次确认（读两遍相差则记 UNVERIFIED 而不是判红）？先量复现率再动判据。
> 用户侧不变：**`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺** ⇒ 备份链 `artifact=0`，
> 具名限期豁免至 **2026-10-12**（`docs/cron-health.json`，到期自动重新判红）；
> M3 分支保护未重跑 ⇒ 记未验证；微信真机验收未做。
