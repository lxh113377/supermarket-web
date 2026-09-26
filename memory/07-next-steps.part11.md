# 07-next-steps.part11.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **F1**：4 张图 option 构造抽成 `src/utils/chartOptions.ts` 纯函数（主题/reducedMotion 入参），hook 只剩生命周期；两者 100% 覆盖。XSS 静态门禁改为**并扫两文件 + tooltip 计数**（防重构后判据静默失焦）。
- **F2/G 批**：确认/支付剩余分支 13 + ProductRow 12 + db.reviews 11 + format/images/rovingTabs 10 + 成功页/404 6。用例 228→**319**（46 文件），覆盖率 stmts 47.63→**57.25%**、lines 59.66%，棘轮 **57/53/50/59**（双跑一致）。
- **P0#1 纠偏（上一轮记录有误）**：`70ca0b9`/`bcaba62` 的 CI 实为 run **#114/#115 双红**，失败步=上一轮刚上线的 CHANGELOG 门禁（`actions/checkout` 默认 depth=1 → 无 `HEAD~1` → fail-closed 分支被触发）。治本 `d1e139d`：ci.yml `fetch-depth: 0` + 脚本内置 `--deepen=3` 自愈（正反例均在 `git clone --depth 1` 里实测）。**连带事实：这两次 push 的 pages.dev deploy 未执行**（改动是测试/门禁类，运行时行为无差异），而 github.io dispatch 独立照常构建 ⇒ 双端可以不同步，验证只认 bundle 指纹。
- **P0#2（产品缺陷，存活 19 天）**：看板 4 张图在生产包**静默空白**——hook 把 echarts `lib/chart|component/*` 的 `.default` 塞进 `core.use()`，而这些深路径模块**零 export**（末尾自注册），`use(undefined)` → `ext.install` 抛 TypeError → async IIFE 内无 catch，页面不弹错。修复 `a002947`：9 模块只 import，`core.use([renderers.CanvasRenderer])`。
  - 三道新判据：① `tests/chartRealRender.test.ts`（echarts 官方 SSR，node 内真渲染，不依赖 canvas/浏览器/密钥）② hook 测试 mock **复刻真库 use 语义**（原空 `vi.fn()` 正是掩盖者）③ `npm run build:stub && npm run serve:stub`（假密钥 + 假 `/web`）打通"登录→看板→真图"浏览器路径。
  - 正反例：修复后 4 canvas（687×392/308/392/448）；回退旧 hook 重建 → 已登录、无"加载失败"文案、**canvas=0**。线上产物判据：`AdminPage-B5_F6y5i.js` 内是 `use([d.CanvasRenderer])`（旧写法正则命中 false）；双端入口同为 `index-DWywB77A.js`；CI run **#117** success。
- **新发现（未修，待裁决 M4）**：演示模式看板永远"看板数据加载失败"——H1-2 聚合下沉服务端后本地模式无对应实现。选项①补客户端聚合（漂移风险）②改文案说明演示模式无聚合（零风险）。
- **观察项关闭**：e2e 的 `Applying inline style violates CSP` = `@vite/client` dev 覆盖层注入，生产构建页控制台零消息 ⇒ 不处理。
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第六轮-2026-09-24.md`；CHANGELOG 追加七/八/九。
- **P0（下轮 H1）**：OrdersTab(44%) + ProductsTab(48%) 专项——最后一块高频写路径没测的大石，预计再 +4~6pp。[推荐:R196-01]（agent 自动）
- **H2 同轮可做**：ProductDetailPage + 评价链（ReviewForm/ReviewList/ProductGallery 全 0%）。[推荐:R196-02]（agent 自动）

## 分卷目录
- **卷1** `07-next-steps.part10.md` — 07-next-steps 分卷（R199 自动拆卷）

