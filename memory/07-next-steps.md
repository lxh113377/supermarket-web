# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。

## 2026-09-27 — 对标第十四轮（D1 往返复杂度：一次动作打多少次数据库）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十四轮-2026-09-27.md`；备份 `_backup/pre-round14-2026-09-27/`；回滚锚 `1e5519e`。第十三轮小节的报告指针曾误写「第十二轮」，已纠（见分卷 31）。

- **一句话**：`functions/` 从未用过 D1 `batch()`，`createOrder` 往返 = 5+N 而旧棘轮只锁定点采样。已落地＝`qBatch` 出口 + 三处常数往返收口（实测 n=10 往返 15→6、`seedReviews` 22→3）+ mock 收敛 `scripts/lib/metered-d1.mjs` + 新门禁 `verify:roundtrips`（A1~A7b、20 项夹具双向变异）接进 verify 链 / ci.yml / `REQUIRED_STEPS`。

### P0（第十五轮开工先做这条，可执行）

- [ ] **M1 rollback 往返判据（接续十三轮，障碍已查明）**：3 个 `rollback-*.sql` 是 `DROP COLUMN`，配对正向件属基线期裸 ALTER 补丁 ⇒ **不可整文件重放**。正解＝逐文件造前置态（建列→rollback→断结构变化→只挑"补回该列"那条再前滚→断结构等值基线）。验收：每个 rollback 一条机器证据。
- [ ] **M2 `batchUpdateProducts` 对账平台预算**：实测语句 = 1 + n，上限 200 ⇒ n=200 时 201 > 免费档 50。修法＝JS 批量校验 + 1 条 bulk UPDATE + 1 条核对，**保留** `{updated, failed[]}`（batch 整批回滚与该语义冲突）。验收：该 action 两条具名豁免被**删除**，n=200 语句 ≤ 3。
- [ ] **M3 套餐档位事实登记**：`STATEMENT_BUDGET_FREE = 50` 是**档位假设**（无 CF 凭据判不出 Free/Paid=1000）。登记进 `docs/env-vars.md`，预算由登记值推导；缺登记判 UNVERIFIED 不判 PASS。
- [ ] **L1 catalog 首轮观察（接续第十二轮）**：`report:catalog` 接成阻断后仍无新的定时跑，误报率无法判。
- [ ] **L2 全表扫描维度：实测后判"不做"**（`EXPLAIN QUERY PLAN` 扫 55 条得 3 处真 SCAN，全部正当：小表 ORDER BY / 导出 LIMIT / 聚合）⇒ 降级报告型先攒误报账，勿上阻断链。
- [ ] 需人不变项与"维持不改"清单未变（`CF_D1_BACKUP_TOKEN` 路线 / `ORDER_WEBHOOK_URL` 端点 / K3 线上目视 / D2 49 单 / R2 桶 / order 41 / `adhoc-rename-order20.sql` 处置；不采纳 Prisma shadow DB、Medusa 事务池、Saleor dataloader）——全文见第十四轮报告 §2·§4。

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
