# 07-next-steps.part6.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **P1 观察**：dependabot 新开 2 个更新 run（autoprefixer / react 系，2026-09-24），下轮按 09-05 先例逐个评估（major 关/小版本合）。

## 2026-09-23 — 第三轮全栈优化（接口+缓存优先 / 11 项，已提交 + 双端上线）

> 来源会话：opencode `ses_f3405631`（09:56–10:19，产出改动但**未提交**）；本轮由 CodeBuddy 会话复核、修正瑕疵、提交并部署。
> 提交 `2b73fbc`（20 文件 +204/−85）。

**后端（接口+缓存优先）**

- **只读密钥越权收口**：`ADMIN_WRITE_ACTIONS` 由 8 项补至 16 项 DB 变更类 action
  （`batchUpdateProducts` / `batchDeleteProducts` / `createOrder` / `recalculateOrders` /
  `addReview` / `addPublicReview` / `seedReviews` / `createSubmission`）。
  原先只读密钥可**批量改价、批量删品、导入种子评价**且不进审计。`verify-backend` 新增 4 条断言锁定
  （批量改价/批量删除/种子导入均被拒 + 读操作仍放行）。
- **AI 建议缓存补写失效**：`cache:ai:advice` 只有 60s TTL、**写操作后不失效** → 改商品/下单/评价后
  最长 60s 仍返回旧快照建议。新增 `invalidateAiAdvice()`，在看板写失效同一收口点调用
  （admin 与 public 两条路径都覆盖），`dashboardCache.test.js` +1 断言。
- **看板写失效集合补齐** `addPublicReview` / `seedReviews`。
- **午夜边界分桶**：`stats.js` 的 `buildRangeData/buildDelta/buildReviewTrend` 各自调 `Date.now()`，
  跨午夜时三者分桶错开一天 → 改为 `getDashboardStats` 单次取 `nowMs` 传入（默认参数，单测 2 参调用仍兼容）。

**前端**

- **新增 `src/prefetchBus.ts`（零依赖预取总线）**，拆断 `routeLoaders ↔ 页面` 的 **3 处真实循环依赖**。
  为什么以前没发现：`scripts/check-import-cycles.mjs` 的 `EXTS` 只有 `.js/.jsx/.mjs`，
  TS 迁移（41 文件）后 walk **永远 0 命中** → 门禁恒报「0 模块 / 无环」= **静默假通过**（与 R263「判据自身坏了」同族）。
  补 8 种扩展名后实扫 70 模块并挖出 3 处真环；复跑 0 环。
- **预取时机修正**：hover 预取 1200ms → **150ms**（原延迟基本等不到点击，预取形同虚设）；
  首屏后的热路由预取去掉嵌套 `onIdle`（原双重等待最长 4.8s）。
- **`catalogCache` 读写双侧浅拷贝**：原先传引用，调用方原地 `sort/push` 会污染 60s 内所有读取方（+2 断言）。
- **`localStore` 商品读路径**由「两次 `getItem`」降为单次直解 + 写 `parseCache`（读 I/O 减半）。
- **`db/products` 分类失败改 `warnOnce`**：与商品侧同口径，弱网重试不再刷屏。
- **`ProductsTab` 三处原生 `alert` → 内联 notice**（不再阻塞主线程）；批量改价
  `ids.map(...products.find)` O(选中×全量) → Map 索引 O(N)。`confirm` 保留。
- **`useDashboardCharts` 主题色 `useMemo` 单读**：原每次 option 更新做 5 次 `getComputedStyle`（强制样式重算）。

## 分卷目录
- **卷1** `07-next-steps.part5.md` — 07-next-steps 分卷（R199 自动拆卷）

