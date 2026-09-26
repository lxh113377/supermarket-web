# 07 分卷 32（第十五轮体量收口：第十四轮 + 第十三轮小节整段搬入，逐字保留）

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

