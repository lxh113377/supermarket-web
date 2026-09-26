# 07-next-steps.part18.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [x] 🔴 **2026-09-25 晚二次翻案：停摆真因 = Free 计划 2,000 Actions 分钟用满**（推翻本文件上面"配额假设已证伪 / 57.6% 未耗尽"那条错判）。
  - **实测证据（登录态浏览器看 `github.com/settings/billing`，唯一权威）**：Actions 面板 `Actions minutes 2,000 min used / 2,000 min included`（进度条 100% 红）、`Billable usage $0`＝`$22.23 consumed − $22.23 discounts`、`Actions storage 0 GB / 0.5 GB`、`Included usage limits reset in 6 days`、最大消耗方 `fenjue-private-archive $6.44`、`Next payment due = -`（**并没有欠费**）。
  - **错判根因**：逐 job `(completed−started)` 累加只覆盖**已完成** run，**漏算 cancelled run 与超额计费分钟**，且账单口径（consumed/discounts）与墙钟不是一回事。⇒ **纪律**：账号级用量只认 Billing 页；PAT 无 `admin:billing`（端点 404）时**读不到 ≠ 反证成功**，不得据此把"配额耗尽"从排除项里划掉。红条那句 `payments have failed or your spending limit needs to be increased` 是 Free 计划用满后的通用措辞。
  - **三条出路（都要用户点头，Agent 不代做）**：① 等 6 天后重置（≈10-01）；② Billing → Budgets / Payment information 加支付方式并抬 spending limit，超额按量付费（Linux 私有仓约 $0.008/min）⇒ 立刻恢复；③ 把跑 CI 的私有仓**临时转公开**（公开仓不计分钟），代价=源码与历史公开。省分钟侧：停 `schedule` 类 workflow、精简矩阵。
  - **本轮已做**：`rerun-failed-jobs` 试过（API 201 → attempt=2 仍 3 秒 0-step、原文一字未变）⇒ 证实不是瞬时抖动，必须走上面三条之一。
  - ✅ **2026-09-25 晚已解（走第③条"转公开"，但先作废密钥）**：转公开前实测到 **10 个历史提交含 ADMIN_KEY 真值**（最早在 `wrangler.toml` 的 `[vars]`，`4034aff` 才改掩码），直接公开=交后台密钥。故按「先轮换 → 重部让新 secret 生效 → 全树扫描 → 再翻 public」执行：新密钥 `login` 返回 `code:0 role:admin`、**旧密钥返回「认证失败」**（泄露值作废）、`/pub` 已下发 8 个口味、`sw.js=sm-v1790337036424`。转公开后 run `36132121389`（dispatch 触发）**success**：build-and-test 22 steps / e2e 10 / e2e-cloud-stub 10 ⇒ **runner 恢复确认**。
  - ⚠️ **仍然开着的两件事**：① `deploy` job 只认 `push` 事件，dispatch 那次是 `skipped` ⇒ 本轮靠"提交 + push main"走完整链路（CI 部 pages.dev + `dispatch.yml` 驱动 github.io）；② **仓库现为 public**，本仓 `AGENTS.md`/`memory/AGENTS.md`/部署 skill 里"私有仓、未认证 API 一律 404、`DEPLOY_SOURCE_TOKEN` 跨仓取私有源码"等表述自此失真，须更正（含 `chaoshi-web-deploy` §2.1/§5.3 与本仓 §6 判据口径）。

## 分卷目录
- **卷1** `07-next-steps.part17.md` — 07-next-steps 分卷（R199 自动拆卷）

