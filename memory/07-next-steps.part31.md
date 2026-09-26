# 07 分卷 31（第十四轮体量收口：从主壳搬出的历史轮次指针，逐字保留）

## 2026-09-26 — 对标第十三轮（迁移可验证性：新库建不建得起来 + 类型漂移 + 契约外文件）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十三轮-2026-09-26.md`（上一版本节误指为第十二轮，已纠）；备份 `_backup/pre-round12-2026-09-26/pre-round12.bundle`。

## 2026-09-26 — 对标第十一轮（备份可恢复性 + 数据面事实；全程走 PR）


- **已落地**：`scripts/verify-migrate-replay.mjs`（`npm run verify:migrate-replay`，零凭据离线）七条判据 A1~A7 + `migrate.mjs bootstrap`（空库→schema.sql→记满账；非空即拒）；接进 verify 链与 CI step。
- **一手实测**：空库按序灌 7 个迁移只成功 6 条语句，5 个文件报 `no such table: products|orders` ⇒ 全新 D1 上 `migrate apply` 必半途崩；`db/adhoc-rename-order20.sql` 因文件名不合契约，账本与旧门禁**双向隐形**。

### P0（第十四轮开工先做这条，可执行）

- [ ] **rollback 往返判据（M1）**：基线→正向→回滚→结构逐字段等于基线；4 个 `rollback-*.sql` 至今零执行验证。
- [ ] **账本快照随仓（M2）**：`db/applied.json` + `exportedAt`；**先设计龄期上界**再上阻断链，否则判据结果里混进"最后一次导出的时刻"。
- [ ] **catalog 接成阻断后的首轮观察（接续第十二轮）**：等下一次 Uptime 定时跑；误报改重试阶梯，不放宽判据。
- [ ] 需人不变项：`CF_D1_BACKUP_TOKEN` 路线、`ORDER_WEBHOOK_URL` 端点、K3 线上目视、D2 49 单、R2 桶、order 41、`adhoc-rename-order20.sql` 处置（改名进账本或删除）。
- [ ] 维持不改（证据在报告 §4）：Prisma shadow DB、Saleor 双版本兼容测试、Flyway teams 版 undo。

## 第十四轮「已落地 / 一手实测」原文（体量收口自主壳搬入，逐字保留）

- **已落地**：`qBatch` 出口（无静默降级）+ `reserveStock`/`releaseStock`/`seedReviews` 收口常数往返（实测 `createOrder` n=10 往返 **15→6**、`seedReviews` **22→3**）；mock 收敛为唯一实现 `scripts/lib/metered-d1.mjs`（补 `batch()`）；新门禁 `verify:roundtrips`（A1~A7b，20 项夹具双向变异）接进 verify 链 / ci.yml / `REQUIRED_STEPS`。
- **一手实测**：`functions/` 里 `\.batch(` 命中 0；`sql-baseline` 的 `P:createOrder=7` 是**定点采样**（fixture 恰 2 件），看不见"每多一件多一次往返"；注释前提「D1 无跨语句事务」被官方文档证伪（batch = SQL transaction，失败回滚整序列）。
