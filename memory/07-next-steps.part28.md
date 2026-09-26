# 07-next-steps.part28.md

<!-- 本卷为 07-next-steps.md 的延续 -->

### P0（第十一轮那份，已被第十二轮取代 — 归档留痕）

- [ ] **备份链"还活着吗"判据（本轮取证带出的新缺口，最高优先）**：备份只活在 GitHub artifact，retention 到期即消失而无人知；且 `d1-backup.yml` 哪天不再被触发（改 cron / 换分支 / token 失效）不会有任何东西变红。做法：`Uptime` 加一步，断"最近一次备份 run 在 N 天内且 conclusion=success"，并把 artifact 到期日写进 `$GITHUB_STEP_SUMMARY`。命令预检（**先本机跑通再写文档**）：`gh api repos/lxh113377/supermarket-web/actions/workflows/d1-backup.yml/runs?per_page=1 --jq '.workflow_runs[0] | .created_at + " " + .conclusion'`
- [ ] **`report:catalog` 摘掉 `continue-on-error` 的决策**：连续两次真跑无误报即接成阻断（新指标先量误报率的既定规矩）。看：`gh run list --workflow Uptime --limit 3 --json headSha,conclusion` ＋ 报文有无假红。
- [ ] **webhook 真实端点验收（需人）**：`ORDER_WEBHOOK_URL` 生产仍未配 ⇒ 线上是安全的 no-op 态；给端点后一次性实测 6 字段载荷与"不外发微信号/截图"。
- [ ] **恢复演练在 CI 侧尚未真跑（重要边界，勿当已完成）**：`d1-backup.yml` 的 visibility 守卫在仓库非 private 时会**先响亮失败**，走不到导出与演练 ⇒ 本轮证据只有"本机对真 dump 全过 + 15 条常驻夹具 + 顺序断言"。等用户选定备份路线（①转回 private ②导出后 age/openssl 加密再上传）之一，用 `workflow_dispatch` 手动跑一次才算 CI 侧真跑。命令预检：`gh run list --workflow "D1 Daily Backup" --limit 3 --json headSha,conclusion`
- [ ] **sha256 可核对性**：目前只写进 step summary；要把"下载回来的就是当时那份"变成判据，需 artifact 名带 run 号 + 恢复脚本可读（涉 GH_TOKEN 权限，先量需求再接）。
