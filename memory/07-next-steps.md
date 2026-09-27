# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。


## 2026-09-28 — 对标第四十一轮（每日配额量成第三把尺；一次看起来成功的假扩面）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十一轮-2026-09-28.md`；轮初锚 `f098f9c`。
> 第三十九轮整块（含 R40 三条 P0 的原文）**逐字迁 卷 69**；其处置结果：R40-H2 已完成、
> R40-H3 已完成、R40-H1 **改判**（见卷 69 原文与本轮报告 §4 #2）。

> **P0（下一轮开工先做这条，可执行）**：**R42-H1 远端用量对账** —— 第三把尺现在只有下界
> （每次调用写多少行，本机实测 createOrder(10 件)=11 行 ⇒ 约 9,090 单/日），
> **累计日用量取不到**：`docs/d1-write-quota.json` 里 `remote_usage` 恒为 `UNVERIFIED`。
> 官方给的三条正规路（`cloudflare/cloudflare-docs partials/workers/d1-pricing.mdx:11-12`）=
> meta object（`docs/d1/worker-api/return-object.mdx:43-44` 的 `rows_read`/`rows_written`）/
> GraphQL Analytics `d1AnalyticsAdaptiveGroups` / dashboard Metrics&gt;Row Metrics。
> 前置：CF 凭据 + **必须先加载 `chaoshi-web-deploy`**；产出必须分 `VERIFIED / UNREACHABLE` 两态并带时刻，
> **禁止**把"没连上"折算成"配额安全"。
> **R42-H2 `writes-artifacts` 穿不过常量路径**（本轮一手）：`check-d1-roundtrips.mjs` 运行时会改写
> 受版本控制的 `docs/d1-write-quota.json`，但 `writeFileSync(WRITE_QUOTA_FILE, …)` 里 `docs` 在常量右侧 ⇒
> 风险表上它是零风险。先取分母：`grep -rn "writeFileSync([A-Z_]" scripts/ | wc -l`（本轮未数，禁无数字提案）。
> **R42-H3 同族扩散自查**：本轮根因是「声明的面 ⇄ 真正喂给采集器的面是两处」⇒
> 在其它多前缀判据里列同类（每条各出一行分母），别默认"扩了就是扩了"。
> 用户侧不变：**M3 分支保护本轮未重跑 ⇒ 记未验证**（承 09-27 13:16:35Z 读数不许抄）；
> `BACKUP_PASSPHRASE` + `CF_D1_BACKUP_TOKEN` 仍缺 ⇒ 备份链 `artifact=0`。

## 历史轮次与在途项

> 本节已按 4KB 上限迁至 `07-next-steps.part48.md`（逐字未改）：H2 保留通道、H6 rate_limits、取证欠账、需人不变项，
> 以及分卷↔轮次对应关系与"每轮抽 2~3 条理由反做"的台账体检口径。

## 分卷目录

- 在册卷号：1–69。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
  **本行由 `V5` 机器对账**（声明 ⇄ 磁盘双向差集）：改卷不并号，下一轮就会被判红。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上（第十七轮压缩史迁至卷 48）。
