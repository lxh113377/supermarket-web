# 07 分卷 33（第十七轮体量收口：第十五轮小节整段搬入，逐字保留）

## 2026-09-27 — 对标第十五轮（函数级授权：谁能改业务数据 + 默认方向扳正）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十五轮-2026-09-27.md`；代码回滚锚 `f9439a0`（第十四轮 bundle 在 `_backup/pre-round14-2026-09-27/`）。第十四/十三轮小节整段见分卷 32。

- **一句话**：只读档的判定式从 `ADMIN_WRITE_ACTIONS.has(action)`（漏登=只读也能做）扳成 `!ADMIN_READ_ACTIONS.has(action)`（漏登=谁都做不了）；新门禁 `npm run verify:authz` 十项 B1~B8b + 18 条夹具。现状 **16 业务写 ⇄ 16 登记 ⇄ 15 读档穷举**，无活漏洞。
- **P0（第十六轮开工先做这条）**
- [x] **M1 rollback 往返判据（第十六轮 c83cadc 已落地）**：A8 结构轨 3 件 + A9 数据轨 1 件，真仓 rc=0「实测覆盖 4 件」。欠账：MA6 夹具两次变异没走到目标断言，现 `it.skip` + 原因注释挂起 ⇒ **第十七轮补**（要验「WHERE 打空 ⇒ 命中 0 行」那条分支）。
- [ ] **M2 `batchUpdateProducts` 对账平台预算**（承十四轮）：JS 批量校验 + 1 条 bulk UPDATE + 1 条核对，保留 `{updated, failed[]}`；验收＝它两条具名豁免被**删除**且 n=200 语句 ≤ 3。
- [ ] **M3 档位事实登记**：`STATEMENT_BUDGET_FREE=50` 是假设；登记进 `docs/env-vars.md`，缺登记判 UNVERIFIED。
- [ ] **M4 修本机 workerd**：`@cloudflare/workerd-windows-64/bin/` 空目录，`wrangler --version` 即崩 ⇒ `verify:functions` 本机长期缺位（只在 CI 有牙）。试 `npm ci` 或换源重装；`package.json`/lock 不得被顺手改动。
- [ ] **L1 权限建模（需老大点头，勿擅自做）**：是否要第三档（店长/客服）。要 ⇒ `ACTION_TIERS` 升级为每 action 声明所需档位 + 构造期穷举（未声明编译不过）。
- [ ] 需人不变项未变（`CF_D1_BACKUP_TOKEN` / `ORDER_WEBHOOK_URL` / K3 目视 / D2 49 单 / R2 桶 / order 41 / `adhoc-rename-order20.sql`）——全文见第十四轮报告 §4。

