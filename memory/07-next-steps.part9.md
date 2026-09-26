# 07-next-steps.part9.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **意外发现**：本机 node_modules 有 extraneous `@img/sharp-wasm32`（LGPL 复合许可，历史镜像安装残留、非 lock 依赖）——下轮清装验证（D3）。
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第三轮-2026-09-24.md`。
- **P0（下轮）**：D1 覆盖率继续爬坡——DashboardTab/AdminPage 两大件进 30%+（AdminPage 886 行是最大未测块）；D2 面板上线后**用一次真实 49 单超时积压做处置演练**（有截图优先确认；无截图逐单取消——禁自动批量）。
- P1：D3 extraneous 清装验证；P2：D4 备份 token 激活（用户配 `CF_D1_BACKUP_TOKEN` 后跑一次 workflow_dispatch 核验 artifact）、D5 R2 直传（沿用第二轮队列）。

## 2026-09-24 — 对标第二轮（幂等 / 迁移账目 / 供应链门禁 / XSS 收口）

- **对标集扩到 5 个**（新增 **Vendure** 8,468★）+ 维度 7→9（加「数据完整性与迁移」「供应链与 CI 安全」）。报告：外层 `deliverables/GitHub开源项目对标分析报告-第二轮-2026-09-24.md`；交付记录：`对标第二轮交付记录-2026-09-24.md`。
- **A1 下单幂等（已上线并线上实证）**：`orders.idempotencyKey` + 部分唯一索引；键 `房间号@requestId#fnv1a(载荷指纹)`；无 requestId 的旧包走 90s 内容指纹兜底（顾客端 SW 长缓存 ⇒ 旧包必然存在，这层不是假想需求）；去重在扣库存前，冲突时回补库存。`requestId` 是**仅传输**字段，**不进** ORDER_FIELDS（该对称契约由 `tests/authWhitelist`/`shared.test` 锁）。
- **A2 迁移账目**：`schema_migrations` + `scripts/migrate.mjs`（status/apply/baseline/mark）+ `verify:schema` 漂移门禁（已进 `npm run verify` 与 CI）+ `db/rollback-*.sql`。**生产已 apply 并 PRAGMA 实证**。
- **A3 echarts XSS**：GHSA-fgmj-fm8m-jvvx（<6.1.0）真实命中，汇点是 tooltip 把入库文本拼成 HTML → `renderMode:'plainText'` 收口，**不升 major**（升版不改变"拼 HTML"的形态，且冲击 `echarts/lib/*` 深路径布局）；`tests/chartXss.test.ts` 静态不变量防回归。
- **A3 依赖审计进 CI**：必须 `--registry=https://registry.npmjs.org`——**npmmirror 未实现 audit 端点**（实测 `NOT_IMPLEMENTED`），不指 registry 会得到一个"在跑但没数据"的假门禁。
- **A4 状态流转乐观锁**：`UPDATE ... AND status = 读到的旧值`（对标 litemall `updateWithOptimisticLocker`）；抢占失败要回补"误取消恢复"刚扣的库存。
- **A5 `stalePendingReport`（只读）**：**有意不抄**对标定时自动砍单——本项目线下确认制下 pending 可能是"已转账待确认"，砍单会误杀真单。**线上盘出 49 单超时 pending**（真实积压，下轮接 UI）。

## 分卷目录
- **卷1** `07-next-steps.part8.md` — 07-next-steps 分卷（R199 自动拆卷）

