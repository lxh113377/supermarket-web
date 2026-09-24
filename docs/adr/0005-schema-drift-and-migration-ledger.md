# ADR 0005: D1 迁移账目表 + schema 漂移门禁

- 状态：已采纳（2026-09-24 第二轮 A2）
- 问题：真相源有两份——`db/schema.sql`（verify-backend 每次据此重建 :memory: 库）与 `db/migrate-*.sql`（线上增量）。
  两者靠人手动同步，漏一回写的症状是"182 个测试全绿、线上 no column named ..."（`migrate-fix.sql` 记录过同款事故）。

## 对标结论
- litemall：三份 dump + README 教人手工改表，**无迁移工具**（20.4k★ 的项目在这点上是反面样本）。
- Medusa：MikroORM，201 个迁移文件，CLI 有 `db:generate` / `db:migrate` / **`db:rollback`**。
- Saleor：Django 1,417 个迁移，CI 里 `test-migrations-compatibility` 迁到 HEAD 后检出 base 代码跑旧测试，
  证明"新 schema 能跑旧代码"（零停机可回滚）；另有 migration_lint 拦"无别名的 index/constraint"。
- Vendure：TypeORM `synchronize:false`，官方要求用自带的 generateMigration/revertLastMigration（自定义字段要多发 SQL）。

## 决策
1. `schema_migrations` 账目表（name 主键 + checksum + appliedAt + note）+ `scripts/migrate.mjs`：
   status / apply / baseline / mark 四个子命令；默认目标 `--local`，生产必须显式 `--remote` 且要求逐字确认串
   （非交互环境直接拒执行，防 CI 误改线上）。
2. 内容 checksum 漂移即 FAIL（Flyway 语义）：已应用的迁移不许改，要改就新增一个修正迁移。
3. 存量库用 `baseline` 建起点，**不回重放**——本项目 `migrate-fix.sql` / `migrate-stock.sql` 是裸 ALTER，
   重放必报错，所以"哪个跑过了"必须有表可查，而不能靠目录约定。
4. `scripts/check-schema-drift.mjs`（`npm run verify:schema`，进 CI 与 verify 链）：逐条解析迁移引入的 DDL 对象
   （表 / 索引 / 列），断言 schema.sql 里都在。未识别的 DDL 形态判 FAIL，禁止静默跳过（R263「判据自身坏了」同族）。
5. 每个新迁移配一个 `db/rollback-<name>.sql`（Medusa/Vendure 的 down() 语义在本仓的最小可用版）。

## 已知不做
Saleor 式"旧代码跑新 schema"兼容性 CI 需要双版本并行构建，单人项目成本 > 收益；
以「迁移一律向后兼容（加可空列、加表、部分索引）+ 先迁移后部署」的顺序铁律代替。
