# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。

## 2026-09-27 — 对标第十六轮（回滚件执行验证：A8 结构轨 + A9 数据轨）

> 代码 `c83cadc` 已推（SHA 与 origin/main 齐）。**外层报告未落笔**（本轮上下文末段耗尽，M1 结论与 10 条夹具证据全在 CHANGELOG 追加三十一 + commit message 里）⇒ 第十七轮若要对标，从 CHANGELOG 重建再补报告，勿当已交付。

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

## 分卷目录

- **卷1** `07-next-steps.part1.md`
- **卷2** `07-next-steps.part2.md`
- **卷3** `07-next-steps.part3.md`
- **卷4** `07-next-steps.part4.md`
- **卷5** `07-next-steps.part5.md`
- **卷6** `07-next-steps.part6.md`
- **卷7** `07-next-steps.part7.md`
- **卷8** `07-next-steps.part8.md`
- **卷9** `07-next-steps.part9.md`
- **卷10** `07-next-steps.part10.md`
- **卷11** `07-next-steps.part11.md`
- **卷12** `07-next-steps.part12.md`
- **卷13** `07-next-steps.part13.md`
- **卷14** `07-next-steps.part14.md`
- **卷15** `07-next-steps.part15.md`
- **卷16** `07-next-steps.part16.md`
- **卷17** `07-next-steps.part17.md`
- **卷18** `07-next-steps.part18.md`
- **卷19** `07-next-steps.part19.md`
- **卷20** `07-next-steps.part20.md`
- **卷21** `07-next-steps.part21.md`
- **卷22** `07-next-steps.part22.md`
- **卷23** `07-next-steps.part23.md`
- **卷24** `07-next-steps.part24.md`
- **卷25** `07-next-steps.part25.md`
- **卷26** `07-next-steps.part26.md`
- **卷27** `07-next-steps.part27.md`
- **卷28** `07-next-steps.part28.md`
- **卷29** `07-next-steps.part29.md`
- **卷30** `07-next-steps.part30.md`
- **卷31** `07-next-steps.part31.md`
- **卷32** `07-next-steps.part32.md`
