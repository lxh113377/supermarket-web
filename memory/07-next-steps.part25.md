# 07-next-steps.part25.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [ ] **`0b9e405`（防线轮 K1+K2）已提交已推送，但线上未更新** —— GitHub Actions 未执行任何 step。
  - **实测证据**：run `36110097808` 两次 attempt，`build-and-test` / `e2e` / `e2e-cloud-stub` 三个 job **全部 0 step、4–5 秒即 failure**（连 `Set up job` 都没有）；`deploy` 正确 `skipped`；`dispatch.yml`（本轮**零改动**）同样 0-step 失败 ⇒ github.io 未被触发。
  - **线上实况**：pages.dev `sw.js` = `sm-v1790316391610`、github.io = `sm-v1790316300946`，两端均仍是 `5ea17e0` 的构建。
  - **归因状态（2026-09-25 已用对照实验收紧，非推断）**：最可能是**账号级 Actions 计量分钟耗尽**（supermarket-web 私有仓，Free 每月 2000 分钟，今天 09-25 接近月末）。本机 PAT **无 `admin:billing` 作用域**（实测 billing 端点 `http=404`）⇒ 用量读不到。
    - **已用实验排除"改动导致"**：本轮**零改动**的 `uptime.yml` 手动 dispatch（run `36115775548`，dispatch 返回 204）同样 **job `probe` steps=0、08:57:51→08:57:54 即 failure**；该 workflow 最后一次变更是 `5fda761`（`git diff HEAD~2 -- .github/workflows/uptime.yml` 为空）。一行本轮代码都不含的 workflow 以同一形态死 ⇒ 非判据红、非 YAML 语法、非 job 配置。另 `deploy: skipped` 与 run 里规划出 `e2e-cloud-stub` 两条，反证新 YAML 被 GitHub 解析成功。
    - **时间线分界**：私有仓 Uptime 定时 `05:49:06 success`、CI `06:00/06:04 success`，**07:54 起整仓全红**（含 `f8e415d` 那次推送）⇒ 存在"从此时刻起不可用"的清晰分界。
    - **未排除的一侧**：GitHub 全局 runner 故障。唯一判别法 = 触发**公开仓** lxh113377.github.io 的 deploy.yml（公开仓不计分钟），但**它会真的发布顾客端** ⇒ 造成半发布（pages.dev 仍旧构建），须用户点名才做。
  - **可执行指令**：① 用户在 GitHub → Settings → Billing 查 Actions 分钟数并处理（买量 / 等 10-01 重置 / 临时转公开）；② 恢复后重跑 run `36110097808`（`rerun-failed-jobs`；配额未解时只会再白红一次）或 `workflow_dispatch` 跑一次完整 CI；③ 完成后按部署 skill §6 核两端 `sw.js` 指纹是否变新 + `wrangler pages deployment list` 看 Production 部署，才算上线。**禁止**用本地 `wrangler pages deploy` 绕过 CI 发版（除非用户明确点名走急救通道）。
  - **配额假设已证伪（本轮实测，替代原先"去查 Billing 分钟数"那条错方向）**：**逐 job 精确累加实测**（686 个已完成 run / 2551 个 job）：合计 **1151.0 / 2000 分钟 = 57.6%**，未耗尽（fenjue 593.6、supermarket-web 220.9、xinyu 185.3、ican 144.1）。真实并行低估倍数 1.46x —— 先前按抽样外推得 ≈1290（偏高约 12%，因抽到 fenjue 偏高的 11-job 矩阵样本），结论同向但已以实测为准。**所以下面第①步不该是查 Billing。**
