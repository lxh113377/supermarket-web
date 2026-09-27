> 本卷为 07-next-steps.md 的延续（承接 part30「第十三轮遗留」清单）。
- [ ] **同轮附带实测：生产 D1 与 seed 的漂移面比台账记录的更大**（2026-09-28，取证方式见下）
  - 取数面：`wrangler d1 export supermarket --remote` 全量导出 1,461,184 B，
    **载回 sqlite 内存库并逐条断言**后才取数（未载回断言的备份不算备份）。
  - 实测：线上 products 55 条 / seed 54 条；按 order 对齐后 **35 条 price 与 seed 不一致**
    （seed 系统性过期，例：order 1~6 线上均 3.5 而 seed 2.66/3.66；order 27~29 线上 0.99 而 seed 1.66）。
    ⇒ 再次坐实「严禁用 db/seed.sql 覆盖 D1」：覆盖一次就把 35 个在售价改回旧值。
  - **spec 零漂移，且线上 p046.spec 本来就是「帮泡」**：长文案「帮泡+可选十三香/麻辣香/山西老陈醋」
    从未进过生产库，只存在于 seed.ts/seed.sql。⇒ 原计划的"收敛 spec"迁移对生产是零操作，
    而其回滚件会把一个**从未存在过的值**写进生产库＝数据损坏。该迁移与回滚件已当场删除，
    口味迁移最终只动 specOptions 一列，且文件名取 taste- 前缀以保证排在 migrate-spec-options.sql
    之后（改历史件被账目表判 DRIFT，实测 exit 1）。详见 db/migrate-taste-baixiang.sql 文件头。
  - 教训固化：回滚件的正确性不能靠"和 seed 一致"来推，必须靠**生产快照载回断言**。
    本轮若不是先做了载回断言，就会带着一条损坏性回滚件上线。
