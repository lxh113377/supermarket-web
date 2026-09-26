# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。

## 2026-09-26 — 对标第十三轮（迁移可验证性：新库建不建得起来 + 类型漂移 + 契约外文件）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十二轮-2026-09-26.md`；备份 `_backup/pre-round12-2026-09-26/pre-round12.bundle`。

## 2026-09-26 — 对标第十一轮（备份可恢复性 + 数据面事实；全程走 PR）


- **已落地**：`scripts/verify-migrate-replay.mjs`（`npm run verify:migrate-replay`，零凭据离线）七条判据 A1~A7 + `migrate.mjs bootstrap`（空库→schema.sql→记满账；非空即拒）；接进 verify 链与 CI step。
- **一手实测**：空库按序灌 7 个迁移只成功 6 条语句，5 个文件报 `no such table: products|orders` ⇒ 全新 D1 上 `migrate apply` 必半途崩；`db/adhoc-rename-order20.sql` 因文件名不合契约，账本与旧门禁**双向隐形**。

### P0（第十四轮开工先做这条，可执行）

- [ ] **rollback 往返判据（M1）**：基线→正向→回滚→结构逐字段等于基线；4 个 `rollback-*.sql` 至今零执行验证。
- [ ] **账本快照随仓（M2）**：`db/applied.json` + `exportedAt`；**先设计龄期上界**再上阻断链，否则判据结果里混进"最后一次导出的时刻"。
- [ ] **catalog 接成阻断后的首轮观察（接续第十二轮）**：等下一次 Uptime 定时跑；误报改重试阶梯，不放宽判据。
- [ ] 需人不变项：`CF_D1_BACKUP_TOKEN` 路线、`ORDER_WEBHOOK_URL` 端点、K3 线上目视、D2 49 单、R2 桶、order 41、`adhoc-rename-order20.sql` 处置（改名进账本或删除）。
- [ ] 维持不改（证据在报告 §4）：Prisma shadow DB、Saleor 双版本兼容测试、Flyway teams 版 undo。
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
