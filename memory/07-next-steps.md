# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。


## 2026-09-28 — 对标第三十九轮（提交面自足：本地全绿与"这提交必红"同时成立）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第三十九轮-2026-09-28.md`；轮初锚 `a19cc0e`。
> R37 整块逐字迁 **卷 64**，本轮细节（接手 R38 的三件、N3 改判读数、首跑复现、自失）迁 **卷 65**。
> 一句话：`package.json`/`ci.yml` 已把 `verify:restore-drill`、`check:live-shape` 接进链路，而这两个脚本
> **一件都没入库** ⇒ 43 个判据在本地全绿与"这提交到 CI 必红"能同时成立；CI 只看提交面、本地链只看
> 磁盘面，两者从不比对。本轮新立 `scripts/check-head-closure.mjs`（五腿 H1~H5，接线 = `.githooks/pre-push`，
> 逃生门 `HEAD_CLOSURE_SKIP` 必须同时给 `HEAD_CLOSURE_REASON`）——首跑独立复现了这次事故（H2 只点名
> 那两件 + 本轮自己共 3 件，其余 41 个引用全绿）。对标：`kubernetes/kubernetes`
> `hack/lib/verify-generated.sh:35,41,49`（HEAD 副本 + porcelain 行数判红）、`rust-lang/rust`
> `src/tools/tidy/src/mir_opt_tests.rs:11,42` 与 `deps.rs:967,979-983`（盘上有而没人登记就红；例外册反向核）；
> 反例 `prettier/prettier` `scripts/ensure-no-files-changed.js:5-8,25`（52,314★ 也只看已跟踪文件）。

> **P0（下一轮开工先做这条，可执行）**：**R40-H1 上限普查取数面不含 `scripts/`** ——
> `check-limit-provenance.mjs:75` `SURFACE_PREFIXES = ['functions/','src/']` ⇒ 43 个门禁脚本自己的数值
> 全在登记册外。**本轮实测分母**：`CONST_RE` 形状可命名常量 5 个 + `_MS` 后缀 4 个 + 平台事实值
> `STATEMENT_BUDGET_FREE=50` 1 个未挂平台行（扩面前先按形状剔掉非"上限"数）。
> ⚠️ 该文件正被并行会话在途改（R38-H2 那 65/10 行 @00:14）⇒ 动它前先 `git status` 确认已入库，别踩在途件。
> **R40-H2** 原提案本轮**实测否证**：workflows 的 `uses:` 24 个引用全是 40 位 sha、**0 个 tag 钉版** ⇒ 无缺口，
> 不做。真缺口只剩 H3 作用面（只到 `scripts/`），但 `uses:` 本地 action 与 workflow_call 实测也是 0 ⇒
> **别给空集立判据**；扩面前提是先证明有人口。
> **R40-H3** `CHANGELOG.md` 曾叠了 **3 个重复 `## [未发布]`** 抬头（本轮实测收敛为 1）⇒ 没有判据守"抬头唯一"。
> 用户侧：**M3 分支保护**承 13:16:35Z `NOT_ENFORCED`（每轮重跑不许抄）；`BACKUP_PASSPHRASE` +
> `CF_D1_BACKUP_TOKEN` 两 secret 仍缺 ⇒ 备份链仍零产物；**N3「部署欠账」本轮改判为当前不成立**（卷 65），别照旧抄。

## 历史轮次与在途项

> 本节已按 4KB 上限迁至 `07-next-steps.part48.md`（逐字未改）：H2 保留通道、H6 rate_limits、取证欠账、需人不变项，
> 以及分卷↔轮次对应关系与"每轮抽 2~3 条理由反做"的台账体检口径。

## 分卷目录

- 在册卷号：1–65。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
  **本行由 `V5` 机器对账**（声明 ⇄ 磁盘双向差集）：改卷不并号，下一轮就会被判红。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上（第十七轮压缩史迁至卷 48）。
