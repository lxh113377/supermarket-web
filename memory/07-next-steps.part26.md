# 07-next-steps.part26.md

<!-- 本卷为 07-next-steps.md 的延续 -->

> 承接 `07-next-steps.part25.md` 同一条目的后续子项（自动归档拆分，未改写内容）

  - **新分界点**：各仓最后一次 success 分别是 supermarket `06:04:30` / fenjue `06:57:56` / xinyu `07:03:29` / **ican `07:37:49`**，此后 5 个私有仓 29 个 run 全 0 step ⇒ 停摆起点在 07:37–07:54 之间，且非同一瞬间（渐进式阻断，不像一次瞬时事故）。GitHub 状态页 `Actions: operational`。
  - **已排除项汇总（供后续别再重走）**：改动导致（零改动的 uptime.yml 同样 0 step）／本仓 Actions 被禁（`/actions/permissions` = `enabled:true, allowed_actions:all`）／YAML 或 needs 配错（GitHub 解析成功、`e2e-cloud-stub` 已规划、`deploy` 正确 skipped）／日志缺失（两个失败 run 的 logs 包均为 22B 空 zip，证明确无 step 执行过）／分钟配额（见上）。**未排除**：账号级 runner 供应或账号侧限制；唯一能一锤定音的证据是**已登录浏览器里那条 run 的红色横幅原文**（in-app 浏览器无登录态，私有仓返 404）。
  - ✅ **2026-09-25 晚已一锤定音（推翻上一条"只能看浏览器"）**：原因**在 API 里就拿得到** —— 失败 job 的 `check_run_url` + `/annotations`。实测原文：`The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`。⇒ 归口**账号计费/消费上限**，与"分钟耗尽"（57.6%）无关、与提交内容无关。通道已沉淀：`npm run ci:status` 在 exit 3 时直接打印「平台原文」行（`--json` 落在 `blockedBy`），取法与"浏览器退为兜底"的更正见 `docs/ci-triage-runbook.md` §2 ⑤ / §4.2。**用户侧处置**：GitHub → Settings → Billing & plans 补支付方式或抬上限（本仓 PAT 无 `admin:billing`，读不到该页）。
