# 07-next-steps.part10.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **H0（需用户 1 分钟）**：线上管理端登录后目视复核看板四张图（本轮只有本地假桩 harness + 产物级判据）。[推荐:R196-03]（用户操作）
- P1：M5 auth/client/localStore 门面测试；M6 ErrorBoundary + 启动链；M3 自建 PR 流试点（本轮两条 P0 都属"main 直推事后才发现"，PR 复核可在合并前拦住）。
- 不变：D2 49 单运营处置等管理员实操；D4 等用户配 `CF_D1_BACKUP_TOKEN`；D5 等 R2；changesets 仅观察。

## 2026-09-24 — 对标第五轮（管理壳/商城页/内联表单测试，覆盖率 47.63%）

- **E1/E2 已完成**：AdminPage(5)+CustomerPage(5)+ProductInlineEditForm(5) 共 15 用例（228/228）；四指标 47.63/43.52/41.39/50.14，棘轮上调 47/43/41/50（双跑一致）。CustomerPage 用真实 useProducts/useCart（一并拉起两 hook）。
- **E3 顺延**（useDashboardCharts 需 canvas 桩或小重构）；**P0（下轮 F1）**：DashboardTab + useDashboardCharts 专项（先抽 option 构造纯函数，再测；预计 +4~5pp 且消掉 ESM/canvas 耦合）。
- P1：F2 OrderConfirmPage/PaymentPage 剩余分支；F3 `stalePendingReport` 49 单运营处置（人）。P2：D4 备份 token（用户）、D5 R2。
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第五轮-2026-09-24.md`。

## 2026-09-24 — 对标第四轮（测试纵深 + D3 清装纠偏）

- **D1 已完成**：`tests/dbFacades.test.ts`(11) + `tests/adminTabs.test.tsx`(7)，213/213；覆盖率 stmts **35.68%** / branches 32.47 / funcs 31.04 / lines 37.43，棘轮上调 **35/32/31/36**。零功能改动（刻意）。
- **D3 结论纠偏**：`npm ci` 清装后 `@img/sharp-wasm32` 仍出现 → 它是 wrangler(dev)→sharp 的合法 dev 树平台可选二进制，**不是**残留；license 门禁 `--omit=dev` 语义被清装反向证实（prod 10/10，清装前后一致）。
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四轮-2026-09-24.md`（第三轮报告同步加了纠偏注）。
- **P0（下轮 E1）**：路由大件测试 AdminPage(110 句未测)+CustomerPage(104)，复用 hoisted IS_CLOUD getter mock 模式，预期再 +8~10pp。
- P1：E2 ProductInlineEditForm（1.58%，含 stock 归一化断言）；E3 useDashboardCharts 抽纯函数再测。
- 不变：D2 运营处置等管理员实操；D4 等用户配 `CF_D1_BACKUP_TOKEN`；D5 等 R2。

## 2026-09-24 — 对标第三轮（覆盖率棘轮 / 超时单工作台 / SQL 配额门禁 / license 门禁）

- **已落地**：B4 页面层测试 +13（195/195，覆盖率 23.65%，阈值棘轮 23/21/20/24）；B5 stalePendingReport→OrdersTab 内联面板（禁弹窗铁律遵守，只读密钥静默降级，取消复用状态机+库存回补同一路径）；C1 单 action SQL 语句峰值基线 `docs/sql-baseline.json`（30 action，写路径 +1 吸收限流窗抖动）；C2 license 白名单门禁（生产树 10/10，extraneous 过滤，未知即拦）→ verify 链 + CI。

## 分卷目录
- **卷1** `07-next-steps.part9.md` — 07-next-steps 分卷（R199 自动拆卷）

