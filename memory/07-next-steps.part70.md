# 卷 70 — 对标第四十二轮（2026-09-28）：cron 的"窗口内成功过"与"最近一次是红的"

> 主卷 R42 事实段的落点（逐字迁移，非重写）。报告：外层
> `deliverables/GitHub开源项目对标分析报告-第四十二轮-2026-09-28.md`。轮初锚 `4212584`，CHANGELOG 取号 **五十七**。

# 卷 70 — 对标第四十二轮（2026-09-28）：cron 的"窗口内成功过"与"最近一次是红的"

> 主卷 R42 事实段的落点（逐字迁移，非重写）。报告：外层
> `deliverables/GitHub开源项目对标分析报告-第四十二轮-2026-09-28.md`。轮初锚 `4212584`，CHANGELOG 取号 **五十六**。

## 接手在途（第三十九轮先例）

并行会话的 R42-H1/H2 停在 `verify:entrypoints` 的 **G2/G9 两条红**上：`check-d1-remote-usage.mjs`
没进登记册（未登记缺口）、`verify-backend.mjs` 派生标签多了 `writes-artifacts`（标签不符）。
在途面备份在 `../_backup/r42_inflight_20260928/`（diff + 4 个未跟踪件，按字节核对 22,331B diff / 49,367B 合计）。
根因是"提交面不自足"——R39 立的那道闸这次拦住的是它自己。**本轮补齐后一并提交**。

## 换尺（本轮的主张）

- 旧尺只量**备份链一条**，且问的是"窗口内有没有成功产出过"（存在性）。
- 实测：`gh run list --workflow=Uptime` 第一行 run `36299454141` @09-27T06:13:21Z scheduled **failure**；
  同一时刻旧尺 `LIVENESS_MODE=presence` 对 uptime.yml **实跑 rc=0**，因为它认的"OK"是 09-26 的一次
  `workflow_dispatch` ⇒ **手动补跑把调度层的红洗白了**，且 OK 那行措辞写的是"最近一次可核对备份"（presence 模式压根不要求备份）。
- `D1 Daily Backup` 自 09-26 连续 2 次 scheduled 判红；日志原文 `::error::未配置 CF_D1_BACKUP_TOKEN`。
  ⇒ **第三十七轮那条"未验证"当场改判**：R37 记的是"'无口令会判红'的语义仍未观测"，现已观测
  （失败 step 名 = `Fail loudly instead of reporting a green no-op`）。同轮也确认 09-24/09-25 那两次
  `success` 是**绿色空转**（导出/上传两步全 skipped、artifact=0）——第十二轮头注里已经写过这件事。
- 两条红 = **1 个根因**（缺 `CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE`，用户侧凭据）。uptime 的红是它的
  `Backup chain liveness` 那步把备份链的 FAIL 搬回来，不是巡检链自坏（`gh run view … --json jobs` 实测 failed steps 长度 1）。
