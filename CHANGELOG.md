# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]

### 2026-09-24 追加七（对标第六轮：图表 option 抽纯函数 + 看板/商品行/评价门面测试，覆盖率 57.25%）
- **F1 小重构（行为不变）**：`useDashboardCharts` 的 4 张图 option 构造逐字段搬到 `src/utils/chartOptions.ts`（主题/动效改为入参，`readChartTheme` 与 `TOOLTIP_BASE` 一并外移），hook 只剩"实例生命周期 + setOption 触发"。**为什么**：原写法只有真挂 echarts/canvas 才走到，等于 4 张图的全部配置零测试；抽出后 chartOptions 与 hook 双双 100% 覆盖
- **F1 新增测试 3 文件 32 用例**：`chartOptions.test.ts`（16：tooltip 运行时 plainText、rangeDays>=90 才挂 dataZoom、TOP 倒序+前 3 名强调色、reducedMotion 关动画、非 hex 变量退兜底色）、`dashboardChartsHook.test.tsx`（6：echarts 全模块 mock——10 个按需模块注册、晚出现容器补建实例、resize 联动、卸载 dispose+监听注销、import 未回即卸载不建实例）、`dashboardTab.test.tsx`（10：KPI/日均/毛利三态/三处空态/区间点击与方向键/CSV 导出 Blob 内容/加载失败两种降级）；DashboardTab 68.83→**92.2%**
- **XSS 静态门禁随重构扩展**：`chartXss.test.ts` 改为**并扫** hook 与 chartOptions 两个文件（只读单文件会让门禁在重构后静默失焦），并补"四张图 tooltip 一个都不能少"计数判据
- **F2 确认/支付页剩余分支 +13 用例**：非营业时间强制下单、空购物车拦截、aria-invalid 与错误节点关联、截图三道闸（未选/超 5MB/压缩失败）、截图随单字段、支付页无单号重定向、sessionStorage 续单号、支付宝提示弹窗、轮询到 cancelled、轮询失败不误报已付、0 金额不渲染价格行；PaymentPage 80→**97.5%**
- **G 批（零成本高价值面）+39 用例**：`productRow.test.tsx`（12，35.71→92.85%：库存角标三态、上下架开关文案与 aria-pressed、内联展开回调时序、键盘等价点击）、`dbReviews.test.ts`（11，src/db/reviews.ts 1.81→100%：字段白名单裁剪、云端失败降级本地、60s 缓存与精确失效、管理端写删抛错口径）、`smallUtils.test.ts`（10，format/images/rovingTabs 全 100%）、`successAndNotFound.test.tsx`（6，成功页复制/查询/跨导航兜底 + 404 页，两文件原 0%）
- 覆盖率 statements 47.63→**57.25%**、branches **53.87%**、functions **50.76%**、lines **59.66%**（313 用例 / 45 文件）；棘轮上调 **57/53/50/59**
- 后端与数据层零改动；`verify:backend` 仍 102/102、契约/schema/license/changelog 全绿、首屏体积 86.4KB 无变化（图表代码在管理端 chunk）、e2e 8/8


### 2026-09-24 追加六（对标第五轮：管理壳/商城页/内联编辑表单测试，覆盖率 47.63%）
- **E1/E2** 新增 3 个测试文件 15 用例（228/228，37 文件）：`adminPage.test.tsx`（tablist 键盘流转、订单增量首拉、商品错误横幅禁静默回退、云端空态种子、本地徽标）、`customerPage.test.tsx`（真实 useProducts/useCart：加载/排序/搜索空态/加购 toast+浮球/错误重试）、`inlineEditForm.test.tsx`（stock '' 不发送、非法值行内拦截、costPrice 归一、create/update 双出口、服务端拒绝行内展示）
- 覆盖率 statements 35.68→**47.63%**、branches 43.52、functions 41.39、lines **50.14%**；棘轮上调 47/43/41/50（双跑数值一致，确定性强）
- **E3 如实顺延**：useDashboardCharts 拉起需 canvas 桩或抽纯函数小重构，性价比让位，仍列 P1
- **F2 CHANGELOG 门禁（同轮直接落地）**：`scripts/check-changelog.mjs`——PR 对目标分支 / push 对 HEAD~1 取 diff，触及 `src|functions` 而 CHANGELOG 无新增内容行 → CI 红；`--relaxed` hotfix 逃生门（warning 留痕）；diff 取不到时**拒绝放行不静默跳过**。正/反例双向实测（反例经临时分支验证 exit 1 后无痕清理）。进 `npm run verify` 链与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第五轮-2026-09-24.md`；后端/UI 零改动

### 2026-09-24 追加五（对标第四轮：覆盖率破 30% + extraneous 定性纠偏）
- **D1** `src/db` 三门面（orders/products/submissions，含云端失败→持久缓存→本地兜底、离线队列、分页去重、重入锁）+ ReviewsTab/SubmissionsTab 组件测试共 **+18 用例（213/213）**；覆盖率 statements 23.65→**35.68%**、branches **32.47%**、functions **31.04%**、lines **37.43%**，阈值棘轮上调 35/32/31/36
- **D3 结论纠偏（重要）**：清装（`npm ci`）后 `@img/sharp-wasm32` **仍然出现**——它不是"镜像安装残留"，而是 wrangler(dev)→sharp 的**合法 dev 树平台可选二进制**；license 门禁按 `--omit=dev` 生产树过滤的语义因此被实证正确（prod 树 10/10 白名单）。上一轮报告"残留信号弹"的定性作废，以本条为准
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四轮-2026-09-24.md`；后端与 UI 代码零改动（纯测试/配置轮）

### 2026-09-24 追加四（对标第三轮：覆盖率棘轮 + 超时单工作台 + SQL/license 门禁）
- **B4** 页面层测试 +13（OrderQueryPage 6 / CartPage 4 / OrdersTab 超时面板 3；195/195），覆盖率 19.68→**23.65%**（stmts），`vite.config` 阈值棘轮上调 23/21/20/24（只升不降）
- **B5** `stalePendingReport` 接 OrdersTab：超时未确认订单**内联面板**（汇总/占用明细/"已传付款截图"徽标/逐单"取消并释放库存"复用状态机+回补路径；只读密钥静默不显示；遵守禁弹窗铁律）
- **C1** 单 action SQL 语句峰值基线：verify-backend 内置计数器，`docs/sql-baseline.json` 30 action（6 次采样并集；审计/限流写路径 +1 吸收 60s 真实窗分支抖动，读路径精确）——N+1/循环语句回归从此 CI 红
- **C2** `scripts/check-licenses.mjs` 生产依赖 license 白名单（GPL/LGPL/AGPL/SSPL/Elastic 与未知许可一律拦），过滤 extraneous（本机实测揪出历史镜像残留 `@img/sharp-wasm32`，含 LGPL 复合条款但**非 lock 依赖**）；已进 `npm run verify` 与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第三轮-2026-09-24.md`

### 2026-09-24 追加三（对标第二轮：幂等 / 迁移账目 / 供应链门禁 / XSS 收口）
- **下单幂等（A1）**：`orders.idempotencyKey` + **部分唯一索引**（`WHERE ... IS NOT NULL`，历史单零影响）；键 = `房间号@requestId#fnv1a(载荷指纹)`；不带 requestId 的调用方（顾客端 SW 长缓存下的旧包）走 90s 内容指纹兜底；去重判定在扣库存之前，真并发撞唯一索引时回补本请求库存再返回既有单；响应新增 `deduplicated` 标记。对标纠偏：**litemall 实际没有任何幂等**（`order_sn` 无唯一索引），做幂等的是 Medusa / Saleor
- **状态流转乐观锁（A4）**：`UPDATE ... WHERE _id = ? AND status = 读到的旧值`，并发迁移只有一个胜出，落败方收到"订单已被他人更新，请刷新后重试"；抢占失败时回补"误取消恢复"刚扣的库存
- **超时未支付单只读盘点（A5）**：新增 `/web stalePendingReport`（不进写操作集合）——按账龄列 pending 单、标记是否附付款截图、统计被占用的有限库存。**有意不做**定时自动砍单（本项目线下确认制下 pending 可能是"已转账待确认"），见 `docs/adr/0003`
- **D1 迁移账目与漂移门禁（A2）**：`schema_migrations` 表 + `scripts/migrate.mjs`（`status|apply|baseline|mark`；默认 `--local`，生产须显式 `--remote` 且逐字确认，非交互环境拒执行；checksum 防改历史）+ `scripts/check-schema-drift.mjs`（迁移引入的表/索引/列必须已在 `schema.sql`，未识别 DDL 判 FAIL）+ `db/rollback-*.sql` 回滚脚本；`verify:schema` 已进 `npm run verify` 与 CI
- **echarts XSS 收口（A3）**：`npm audit`（官方源）命中 GHSA-fgmj-fm8m-jvvx（echarts <6.1.0），真实汇点是营收柱 tooltip 把入库文本拼成 HTML → 统一 `renderMode: 'plainText'`（不升 major 版本，理由见 `docs/adr/0004`）；新增 `tests/chartXss.test.ts` 静态不变量断言
- **依赖漏洞审计进 CI**：`npm run audit:deps`（固定 `--registry=https://registry.npmjs.org`，因 npmmirror 实测未实现 audit 端点会静默无数据；high+ 阻断，端点故障非 0 退出）
- **覆盖率棘轮（B1）**：`vite.config.js` 钉死 `include: ['src/**']` 后阈值 19.5/18/17.5/21。**口径纠偏**：此前记的 45.8%/43.72% 是"仅被测试加载文件"口径，src 全域真实值为 **19.68%**（页面层基本没测），棘轮只升不降
- **首屏预算按归因重设（B2）**：77.9KB → 86.4KB 的增量逐块归因为 `react-vendor` 66.0KB gz（占首屏 76%，react 19.3 + vite 8.3 抬基线），预算 90 → 95KB（实测 ×1.10），门禁新增"首屏构成 top3"输出
- **文档（B3）**：`docs/adr/0001-0005` 五条决策记录（状态机 / 幂等 / 库存与不自动砍单 / 预算与 XSS / 迁移账目）；`scripts/gen-api-doc.mjs` 由契约渲染人读版 `docs/API.md`（39 action，`npm run docs:api`）；README 的 CI/契约/迁移段落回写为实测数字
- 门禁终态：lint 0/0（140 文件）｜tsc 双配置 0 错｜vitest **182/182**（29 文件）｜verify-backend **101/101**｜契约 **44**｜schema 漂移 **16/16**｜e2e **8/8**｜体积 **3/3**
- 核验纪律：子代理初稿两条高危主张（workflow 未锁 SHA、`dify.js` 密钥可被客户端外发）经逐文件实测**驳回**——15 处 `uses:` 全部锁 SHA、`DIFY_BASE_URL` 只来自服务端 env

### 2026-09-24 追加二（用户裁决轮：库存 + 订单查询 + D1 备份）
- **库存管理与防超卖**（对标 C1）：`products.stock`（-1=不限售，存量商品迁移后行为不变）；下单即占用（守卫式条件 UPDATE 防并发超卖，任一失败同请求内补偿回补）；取消/删除进行中单回补、误取消恢复重新占用；管理端内联编辑新增库存字段 + 行内「缺货/低库存」角标；顾客端公开接口下发 stock
- **订单查询页** `#/order-query`（对标 litemall 订单跟踪）：输单号看 5 步进度；成功页展示订单号 + 复制 + 查询入口（sessionStorage 兜底跨导航找回单号）
- **D1 每日备份**：`.github/workflows/d1-backup.yml`（cron 04:00 北京；缺 `CF_D1_BACKUP_TOKEN` 显式 warning 跳过不假绿；导出物进私有仓 artifact 保留 30 天）；本轮已手动全量导出留档 `_backup/d1/supermarket-2026-09-24.sql`（1.44MB）
- 生产迁移：`db/migrate-stock.sql`（ALTER 加列，**先迁移后部署**顺序铁律写在文件头）
- 门禁：lint 0/0 ｜ tsc 0 错 ｜ vitest 176/176 ｜ verify-backend **84/84**（+18 库存断言）｜ e2e **8/8** ｜ build + 体积 3/3

### 2026-09-24 追加（GitHub 开源对标轮：履约闭环 + 门禁加深）
- **订单履约状态机**（对标 litemall 订单域）：3 态扩为 5 态 `pending→paid→delivering→completed` + 旁路 `cancelled`；服务端 `ORDER_TRANSITIONS` 单点强制非法迁移（status 列 TEXT 无 CHECK，**零 D1 迁移**）；管理端行内下拉只呈现合法下一步
- **顾客侧订单进度**：新增 `/pub getOrderStatus`（只回 status/updatedAt，订单号即凭证）；支付页轮询改走该公开接口——**顺带修复真实缺陷**：旧实现用 `adminCall('getOrder')`，顾客端无会话密钥必然鉴权失败，"付款已确认"轮询在顾客侧从未生效
- **前后端迁移表 parity 锁**：`src/utils/orderStatus.ts` ↔ `functions/lib/actions/orders.js` 深度相等由 `tests/orderStatus.test.ts` 断言
- **e2e 3→7 用例**：新增下单主链路、空表单防误、管理端状态流转三链路；`vite.config.e2e.js`（空 envDir）隔离本机 `.env`，使本地 e2e 与 CI 行为一致（此前本机跑必然进云端模式全挂）
- **CI 门禁加深**：Test 步骤并产 v8 覆盖率（artifact，非阈值门禁）；新增 `check:cycles` 与 `verify:contract` 阻断步骤（此前二者只在手动 `npm run verify`）
- **文档**：新增 `docs/ARCHITECTURE.md`（系统图/关键不变式/门禁链表）；README 架构入口
- 门禁：oxlint 0/0 ｜ tsc 双配置 0 错 ｜ vitest **176/176**（28 文件）｜ verify-backend **66/66** ｜ 契约 /web 30 + /pub 8 ｜ e2e 7/7 ｜ 覆盖率本机可用（旧"worker 崩溃"结论作废，vitest 5 + coverage-v8 已修复）

### 待办
- ~~覆盖率阈值门禁~~ → 本机已可跑（全量 45.8% lines），阈值门禁暂缓：页面层覆盖低，先补再卡

### 2026-09-24 追加
- **e2e 冒烟转正式门禁**：4 条用例在 CI 实跑全绿（首页/搜索过滤/加购/后台），移除 `continue-on-error` 使 `e2e` job 具备阻断力
- 期间修复：oxlint `no-console`（e2e 文件级豁免）、商城路由实为 `/#/shop`、演示模式商品 id 为 `p_{order}`、演示模式后台直接放行
- 三个 workflow（ci/dispatch/uptime）全部固定 Actions 到提交 SHA 并加 `permissions: contents: read`
- CI 状态查询通路：仓库为私有，未认证 API 404；可用本机 gh 凭据（凭据管理器 `git:https://github.com`）走 API 查询与触发 workflow_dispatch


## [0.1.0] - 2026-09-23

### 新增
- 商品图内容修正：40 号错图（呀！土豆 → 好友趣）与 18 号参数表图换实物图（`ce51d77`）
- `aiAdvice` 独立限流（60s/10 次，分桶 `rate:aiadv:{ip}`，位于鉴权之后）（`22b5e90`）
- 社区标准文件：`LICENSE`（MIT）、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
- 产物体积预算门禁：`scripts/check-bundle-size.mjs`（从 dist/index.html 解析首屏资源，按 gzip 卡阈值：首屏 JS ≤90KB / CSS ≤11KB / 单 chunk ≤90KB；实测 77.9 / 8.7 / 58.1），CI 在 build 后执行
- 端到端冒烟骨架：`playwright.config.ts` + `tests/e2e/smoke.spec.ts`（商品浏览/搜索/加购/后台登录 4 条），跑在 dev server 的本地演示模式；CI 新增 `e2e` job（首轮试跑）
- 接口契约外化：`docs/api-contract.json`（`/web` 29 + `/pub` 7 = 36 个 action，含写操作/缓存键/限流桶属性）；`npm run gen:api-contract` 生成，`npm run verify:contract` 校验漂移（41 断言，已接入 `npm run verify`）
- CI 加固：三个 workflow 全部加最小权限 `permissions: contents: read`；所有 GitHub Actions（`checkout` / `setup-node` / `upload-artifact` / `download-artifact` / `github-script`）固定到提交 SHA

### 修复
- 商品图 HTTP 强缓存 7 天 → 10 分钟 + SWR，换图最快 10 分钟可见（`b2b94af`）
- 只读密钥越权口：`ADMIN_WRITE_ACTIONS` 白名单 8 → 16 项（`2b73fbc`）
- `cache:ai:advice` 写后不失效 → 补 `invalidateAiAdvice`（`2b73fbc`）
- 3 处真循环依赖（routeLoaders ↔ 页面）用 `src/prefetchBus.ts` 拆断（`2b73fbc`）
- 浮层层级重排：安装引导遮罩 `z-[90]` → `z-[70]`（`75b5f5e`）
- `scripts/verify_images.py` 路径硬编码导致的静默假失败

### 优化
- 前端六维深度优化（性能 / 体验 / 响应式 / 代码质量 / 可访问性 / 浏览器兼容），响应式同口径复测 53 → 约 91 分（`91c4fad`）
- 二轮优化：商品图全量重编码（体积 -15%）、AI 建议会话缓存、轮询感知页面可见性、批量写合并、CSP 收紧、死代码清理（`a399cbf`）
- 第三轮全栈优化：I/O 与渲染减负、缓存失效补全（`2b73fbc`）
- 顾客端轻量视觉打磨：列表入场动画、详情页骨架屏（`22b5e90`）

### 文档
- README 校正测试数量（82 → 实测 168）与 CI 描述
