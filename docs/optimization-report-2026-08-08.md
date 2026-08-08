# 超柿 Web 专家团优化报告（2026-08-08）

## Abstract

本报告基于 `C:\Users\37533\Desktop\超市web\supermarket-web` 仓库实测状态（2026-08-08 15:10 前后）编写，全部数据来自代码、测试输出、Git 状态与项目记忆文件，未引入任何推测性数字。核心结论如下：

1. 项目质量基线健康：97 个单测全绿（7 个测试文件）、`tsc --noEmit` 0 错误、oxlint 0 error、Vite 构建成功并自动 bump Service Worker 版本，四项门禁本次全部复跑通过。
2. 待办清单与用户计划完全对齐：`memory/07-next-steps.md` 中的 P1 三项（评价晒图云存储直传、冒烟脚本化、清理迁移脚本）与 P2 看板增强均在本次「全量推进」范围内，且都具备明确的代码改造锚点。
3. 发现 3 个上线前必须处理的外部依赖/环境风险：CloudBase 存储「安全域名 + 匿名读写」未确认开启（P1-1 唯一外部依赖）；当前 CSP 未放行云存储域名（不改会导致云图裂开）；PATH 中 `gh` 为 0 字节失效符号链接（真实 `gh.exe` 已登录 GitHub，需用完整路径调用）。
4. 工作区处于「TS 迁移已暂存重命名 + 57 个文件未暂存内容改动」的中间态，.env 与 cloudbaserc.json 均被 gitignore 正确排除，本地 commit 前无需清理密钥风险。
5. 建议执行顺序：P1-1（含 CSP/渲染兼容）→ P1-2 冒烟脚本 → P1-3 脚本归档 → P2-1 看板增强 → P2-2 GUI 定向优化 → 全量部署 → git commit + 私有仓库推送；P0 三项（观察 3-7 天、自定义域名、日志检索）保持监控状态，不标记完成。

## 1. 引言

### 1.1 背景

「超柿」是面向宿舍/小区场景的在线超市购物系统，顾客端支持浏览、加购、下单、扫码支付与公开评价，管理后台支持商品、订单、看板、评价与服务表单管理。系统已于 2026-08-08 完成全量上线（49 商品、20 条种子评价、/web 与 /pub 双 HTTP 路由），本次为上线后的第一轮专家团全流程优化。

### 1.2 目标与范围

本次优化范围严格限定为：

| 编号 | 范围 | 说明 |
|------|------|------|
| P1-1 | 评价晒图云存储直传 | base64 入库改为 `app.uploadFile` + fileID + `getTempFileURL` 渲染，付款截图不动 |
| P1-2 | 部署冒烟脚本化 | 新增零依赖 `scripts/smoke-deploy.mjs` + `smoke` 脚本 |
| P1-3 | 清理迁移脚本 | 确认无引用后归档 `migrate-ts.mjs` / `repair-imports.mjs`（可恢复，不硬删） |
| P2-1 | 管理看板增强 | costPrice 字段 + 近 14 天评价趋势 + 饮品/食品毛利率卡片 |
| P2-2 | 两端 GUI 定向优化 | 顾客端品牌统一/移动兼容/无障碍，管理后台状态与可读性 |
| P0 | 监控项 | 观察 3-7 天、自定义域名、日志检索接入——保持待办，不标记完成 |

技术栈沿用现有 Vite + React 19 + Tailwind + CloudBase，不引入 MUI 或任何第三方图表库（看板继续使用 `DashboardTab.tsx` 内自实现的纯 SVG LineChart/DonutChart）。

### 1.3 方法与数据来源

审计采用「四源交叉」方法：源码直接取证（rg/文件读取）、门禁实测（npm test/typecheck/lint/build 本次实际运行）、Git 状态取证（staged/unstaged/ignored）、项目记忆核对（`memory/01~08` 与 HANDOFF.md）。所有改动点均附文件级证据行，可回溯。

## 2. 现状审计

### 2.1 项目基线

| 维度 | 实测值 | 证据 |
|------|--------|------|
| 技术栈 | React 19 + Vite 8 + Tailwind 3 + react-router-dom 7（HashRouter）+ @cloudbase/js-sdk 3.6.4 | package.json |
| 线上地址 | https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com/#/ | index.html preconnect / HANDOFF |
| 环境 ID | chaoshi-d2g5xfkao100010ef（ap-shanghai） | index.html preconnect |
| 数据库集合 | sm_categories / sm_products / sm_orders / sm_reviews / sm_submissions | admin-api/shared.js ensureCollection 调用 |
| 线上数据量 | sm_products=49、sm_reviews=20、sm_submissions=1、测试订单已删 | HANDOFF 上线记录 |
| Git 分支 | main，无任何 remote | git branch / git remote -v 实测 |
| 工作区状态 | 41 个 TS 重命名已暂存（0 增删）+ 57 个文件未暂存改动（+1634/-592）；memory/、AGENTS.md、src/types.ts、tsconfig.json、scripts/migrate-ts.mjs、repair-imports.mjs 未跟踪 | git status/diff 实测 |
| 密钥安全 | .env 与 cloudbaserc.json 均被 gitignore 排除 | git check-ignore 实测 |
| 云函数 | admin-api / public-api，均 CommonJS JS，@cloudbase/node-sdk ^3.18.3，public-api 已含 node_modules | 两函数 package.json + 目录实测 |
| 部署工具 | tccli.exe 可用（Python312 Scripts）；tcb CLI 3.6.4（package.json devDependencies） | Get-Command 实测 |

### 2.2 质量门禁实测（2026-08-08 本次复跑）

| 门禁 | 结果 | 输出证据 |
|------|------|----------|
| npm test | 7 files / 97 tests 全绿，515ms | `Test Files 7 passed (7) / Tests 97 passed (97)` |
| npm run typecheck | 0 错误 | tsc --noEmit 无诊断输出 |
| npm run lint | 0 error（6 条 warning：scripts 与 vite.config 的 console） | oxlint 输出 |
| npm run build | ✓ built in 1.37s，[sw-version] sm-v1786173099389 | build 输出尾部 |

结论：四项门禁与 HANDOFF「97 单测全绿 / strict 0 错误」的纪录一致，仓库当前处于可构建、可测试的健康状态，优化可在该基线上直接叠加。

### 2.3 业务功能现状

| 功能域 | 现状（证据） | 与本次优化的关系 |
|--------|--------------|------------------|
| 评价晒图 | `ProductDetailPage.tsx` compressImage：canvas 最大边 800px、质量 0.6、输出 dataURL；前端过滤 ≤2MB、≤5 张；提交走 `addReview`；`shared.js` addReviewHandler 按 REVIEW_FIELDS 白名单收口、images slice(0,5) | P1-1 改造点：压缩后改 uploadFile，渲染端解析 fileID |
| 评价渲染 | 详情页 `review.images` 直接作 img src（第 331-333 行）；ReviewsTab 不渲染图片；云端 20 条种子评价无 date/createdAt 字段（导入时由服务端打 createdAt） | fileID 直出无法显示 → 需 getTempFileURL 批量解析 + 会话缓存 |
| 字段白名单 | `cloudfunctions/shared.js` PRODUCT_FIELDS 10 字段（无 costPrice）；`src/auth.ts` 客户端对称白名单同构；types.ts Product 无 costPrice | P2-1 需三处同步加 costPrice（服务端单源 + 客户端对称 + 类型） |
| 管理编辑 | `ProductsTab.tsx` InlineEditForm 内联展开（条目正下方），无弹窗/抽屉；ProductForm 无成本字段 | P2-1 内联加成本输入，保持红线 |
| 看板 | `DashboardTab.tsx` 纯 SVG LineChart/DonutChart（本地实现，未引图表库）；数据仅来自 orders prop：本周订单/营收/累计、近 7 天订单趋势、饮品/食品占比、TOP10 | P2-1 复用 LineChart，新增 getAllReviews 数据源与毛利率卡片 |
| 评价数据源 | admin-api 已有 `getAllReviews`（sm_reviews orderBy createdAt desc limit 1000） | P2-1 评价趋势直接可用 |
| 顾客端品牌 | HomePage 文案为「江科校园服务 / 一站式校园生活服务平台 / 江西科技学院 · 校园服务平台」，与品牌「超柿」（index.html title）不一致 | P2-2 品牌文案统一 |
| 移动端兼容 | index.html 已有 viewport-fit=cover；index.css 无 safe-area env() 内边距、无 -webkit-touch-callout、`.input-base` text-sm（14px，触发 iOS 聚焦缩放） | P2-2 加固项 |
| 图片降级 | ProductDetailPage/ProductCard 均有 onError 占位降级 | P2-2 仅需补多图场景一致性 |
| 管理端状态 | ReviewsTab/SubmissionsTab 有 loading + 空态；OrdersTab 仅有空态、无加载态 | P2-2 补齐 |
| 无障碍 | aria-label 计数：ProductDetailPage 7、Cart/Customer/OrderConfirm/Payment 各 1、Home/Category/Admin/OrderSuccess/ServiceForm 为 0 | P2-2 关键图标按钮补齐 |

### 2.4 与既定待办的一致性核对

`memory/07-next-steps.md` 与 HANDOFF 记录的 P1/P2 清单，与用户本轮计划逐项一致，无新增需求、无冲突项：

| 来源项 | 用户计划 | 一致性 |
|--------|----------|--------|
| P1 评价晒图改云存储直传（注意先配安全域名） | P1-1 云存储直传，配置后即用 | 一致 |
| P1 部署冒烟脚本化 | P1-2 smoke-deploy.mjs + smoke 脚本 | 一致 |
| P1 清理迁移脚本（确认无后续用途后删除） | P1-3 移入 archive/2026-08-08-migration-tools/（可恢复） | 一致（用户细化「不硬删」） |
| P2 数据看板增强（评价趋势、分类毛利率） | P2-1 近 14 天评价趋势 + 毛利率卡片 + costPrice | 一致（用户细化为近 14 天） |
| P0 观察 3-7 天 / 自定义域名 / 日志检索 | P0 保持待办/监控 | 一致 |

### 2.5 风险与缺口

| 风险 | 等级 | 现状证据 | 应对 |
|------|------|----------|------|
| 云存储安全域名未确认 | 高（P1-1 唯一外部依赖） | 用户计划明示「配置前上传会失败」；本机无法查询控制台配置 | 代码先就绪；部署后交付人工配置清单 |
| CSP 未放行存储域名 | 高 | index.html：`img-src 'self' data: blob:`、`connect-src` 仅 tcloudbase 系域名 | P1-1 必须同步放开 COS/存储域（如 *.myqcloud.com / *.tcb.qcloud.la），否则云图全部裂开 |
| PATH 首位 gh 为 0 字节失效 reparse point | 中 | `C:\Users\37533\.local\bin\gh` Length=0；真实 `gh.exe` 在 `C:\Program Files\GitHub CLI\` 且已登录 lxh113377（repo scope） | 部署阶段用完整路径调用，或先修复符号链接 |
| 工作区中间态未提交 | 中 | 41 staged + 57 unstaged | 全量推进完成后一次性 commit，先核对 diff 再提交 |
| 种子评价无真实日期分布 | 低 | cloud 端 SEED_REVIEWS 无 date/createdAt 字段，导入时间即 createdAt | 14 天趋势上线初期呈导入日单点，属预期，真实评价积累后自然平滑 |
| 线上数据无成本数据 | 低 | 管理端从未录入 costPrice | 毛利率仅统计已填成本商品，无成本显示「待录入」，不凭空造数 |

## 3. 需求池

### 3.1 优先级框架

按「外部依赖阻塞性 × 用户价值 × 改动成本」三维排序：P1 为上线承诺项（阻断部署验收），P2 为增强项（随本次上线），P0 为监控项（不完成、只观察）。每项需求给出：现状 → 目标 → 关键约束 → 验收标准。

### 3.2 P1-1 评价晒图云存储直传

**现状**：顾客评价图片以压缩后 base64 dataURL 入库（≤5 张 × ≤2MB），单条评价文档体积可达 ~10MB，长期污染 sm_reviews 集合。

**目标**：

1. `ProductDetailPage` 压缩逻辑（canvas 800px / quality 0.6）保持不变，压缩产物由 dataURL 改为 Blob，调 `app.uploadFile({ cloudPath: 'reviews/{ts}-{rand}.{ext}', filePath })` 直传云存储。
2. `review.images` 存 fileID（`cloud://...`），服务端 REVIEW_FIELDS 与 5 张上限不变。
3. 渲染端批量 `getTempFileURL` 解析 fileID → 临时 URL，带会话级缓存；旧 base64 图片（data:image/...）兼容直出。
4. 付款截图维持 base64 不动。

**关键约束**：

- 需用户开启 CloudBase 控制台「安全域名」+ 存储匿名读写（唯一外部依赖，配置前上传报错属预期）。
- index.html CSP 必须同步放行存储临时 URL 域名（img-src 与 connect-src），否则图裂。
- 云函数侧字段白名单/校验逻辑零改动（服务端不感知文件来源）。

**验收**：新增 fileID 兼容渲染逻辑单测；人工验收「配置安全域名后试传 1 张评价图」；旧 base64 历史评价正常显示。

### 3.3 P1-2 部署冒烟脚本化

**现状**：部署后冒烟靠人工 curl，public-api 曾因包内缺 node_modules 静默失败（已修复，但无防线）。

**目标**：新增 `scripts/smoke-deploy.mjs`（零依赖，Node 原生 fetch）：

1. 验证 `/web` getOrders 与 getProducts（需 ADMIN_KEY，从环境变量或本地 cloudbaserc.json 读取，禁止硬编码/入库）。
2. 验证 `/pub` getPublicProducts（无需密钥）。
3. 验证静态站根路径 HTTP 200。
4. 每项输出 PASS/FAIL，全过 exit 0，任一失败 exit 1。
5. package.json 新增 `smoke` 脚本，HANDOFF 记录用法。

**约束**：不改 chaoshi-web-deploy skill 主体；脚本不落任何密钥。

**验收**：本地部署后 `npm run smoke` 全 PASS；CI/本地可用。

### 3.4 P1-3 清理迁移脚本

**现状**：`scripts/migrate-ts.mjs`、`scripts/repair-imports.mjs` 仅被文档（AGENTS.md、memory/02-structure.md、memory/07）与脚本自身互相引用，package.json 无引用、src 无引用；lint 对两脚本各报 console warning。

**目标**：确认无引用后整体移入 `archive/2026-08-08-migration-tools/`（保留可恢复），不硬删。

**验收**：scripts/ 下两脚本消失、archive 目录存在、git status 可见移动记录、构建门禁保持全绿。

### 3.5 P2-1 管理看板增强

**目标**：

1. 商品新增可选 `costPrice` 字段：同步 `cloudfunctions/shared.js` PRODUCT_FIELDS、`src/auth.ts` PRODUCT_FIELDS、`src/types.ts` Product 类型、ProductsTab ProductForm 与 InlineEditForm 内联成本输入（数字、可选、保留两位小数语义），禁弹窗/抽屉红线不变。
2. DashboardTab 新增「近 14 天评价趋势」卡片：复用现有 LineChart，数据源 admin `getAllReviews`，按 createdAt 聚合每日数量，空数据展示「暂无数据」。
3. DashboardTab 新增「饮品/食品毛利率」卡片：仅统计已填成本商品的订单（`(price - costPrice) * quantity`），饮品/食品分类沿用现有 drinkSubs 判定；无成本商品不计入分母，全部未填成本时显示「待录入」。

**约束**：不引入图表库；成本数据不凭空造数；服务端不因缺 costPrice 拒绝历史商品。

**验收**：新增 costPrice 白名单透传测试（客户端 + 服务端）；毛利率/评价趋势纯函数单测覆盖空数据、无成本、边界（14 天窗口、0 销量）；`npm run lint` 通过。

### 3.6 P2-2 两端 GUI 定向优化

**顾客端**：

1. HomePage 品牌文案与「超柿」统一（当前为「江科校园服务 / 一站式校园生活服务平台 / 江西科技学院 · 校园服务平台」）。
2. 删除 `src/App.css` Vite 模板死代码（已确认零引用：main.tsx 仅 import index.css，全仓 rg 无 App.css 引用）。
3. iOS/微信内置浏览器兼容加固：safe-area（env(safe-area-inset-*) 页面底部/头部留白）、input/select/textarea 字号 ≥16px 防聚焦缩放、-webkit-touch-callout 关闭。
4. 详情页图片加载/失败占位在多图轮播场景保持一致（现有单图 onError 已具备）。
5. 关键按钮 aria-label 补齐（重点：HomePage/CategoryPage 分类卡片、AdminPage 图标按钮、OrderSuccessPage 操作按钮等纯图标/无文本按钮）。

**管理后台**：

1. 看板新图表（评价趋势、毛利率卡片）与现有卡片视觉风格对齐（白卡 + shadow-card + section-title + animate-fade-in-up）。
2. OrdersTab 补加载态（现有仅空态）；ReviewsTab/SubmissionsTab 状态已具备，保持。
3. ProductsTab 保持 InlineEditForm 内联红线，不做弹窗改造。
4. 后台表格移动端可读性：关键列最小宽度/横向滚动容器检查。

**不做**：全面视觉改版、品牌色变更。

### 3.7 P0 监控项（保持待办）

| 项 | 状态 | 依据 |
|----|------|------|
| 线上全链路人工验收（AC-OBS-09） | 待用户执行 | memory/08：强刷后走通首页→详情(order20 猎兽图+评价)→加购→下单→支付→后台 |
| 观察线上 3-7 天 | 监控中 | memory/07：关注 sm_orders/sm_reviews 计数与 /pub 稳定性 |
| 自定义域名 + HTTPS | 待办 | memory/07 P2（用户计划归 P0 监控） |
| 日志检索接入 | 待办 | tcb fn log 在 CLI 3.6.4 不可用，改控制台或 tccli |

## 4. UI 描述

### 4.1 顾客端

| 页面 | 当前 | 目标 |
|------|------|------|
| HomePage | 顶部渐变：「江科校园服务」+「一站式校园生活服务平台」；底部「江西科技学院 · 校园服务平台」 | 主标题统一为「超柿」，标语与品牌一致（具体文案待用户确认，见第 6 节）；底部文案同口径 |
| 详情页 | 主图/轮播 onError 降级已具备；评价图直接渲染 review.images | 轮播各图失败占位一致；评价图支持 fileID 解析 + base64 兼容；上传失败/超限文案保留 |
| 全局（iOS/微信） | viewport-fit=cover 已有；输入框 text-sm（14px）；无 safe-area 留白；长按图片可弹系统菜单 | 表单输入 ≥16px；safe-area 底部留白；touch-callout 关闭；样式零品牌色变更 |
| 全局（无障碍） | 部分页面有 aria-label（详情 7 处等），纯图标按钮仍缺 | 关键图标/无文本按钮补齐 aria-label，语义标签不重复 |

### 4.2 管理后台

| 区域 | 当前 | 目标 |
|------|------|------|
| ProductsTab | InlineEditForm 内联展开；表单含名称/规格/价格/排序/主图/轮播/介绍/上下架 | 价格旁新增「成本价（可选）」数字输入，其余交互不变 |
| DashboardTab | 数据卡（本周订单/营收/累计）+ 近 7 天订单趋势 + 分类占比环形图 + TOP10 | 新增「近 14 天评价趋势」折线卡（复用 LineChart）+「饮品/食品毛利率」卡（无成本显示「待录入」），风格与现有卡片一致 |
| OrdersTab | 仅空态「暂无订单（需开启匿名登录）」 | 补加载中状态；表格移动端横向可读 |
| ReviewsTab / SubmissionsTab | loading + 空态已具备 | 保持现状，随全局样式微调 |

## 5. 验收标准与外部依赖

### 5.1 门禁

| 项 | 标准 |
|----|------|
| 单测 | 现有 97 保持全绿；新增 costPrice 白名单透传、毛利率/评价趋势纯函数（空数据/无成本/边界）、fileID 兼容渲染逻辑测试 |
| 类型 | `npm run typecheck` 0 错误 |
| Lint | `npm run lint` 0 error |
| 构建 | `npm run build` 成功且输出含 `[sw-version]` 行 |
| 部署 | hosting/fn deploy 输出成功；tccli DescribeEnvs + DescribeHTTPServiceRoute 确认 /web、/pub 路由；双端点 curl code 0；DescribeTables 复核 sm_reviews |
| 冒烟 | `npm run smoke` 全 PASS |

### 5.2 外部依赖

| 依赖 | 状态 | 责任方 |
|------|------|--------|
| CloudBase 存储安全域名 + 匿名读写 | 未确认，代码先就绪 | 用户控制台配置 |
| GitHub 私有仓库推送 | gh.exe 已登录（lxh113377，repo scope），PATH 符号链接需绕过/修复 | 部署阶段处理 |
| 管理密钥（ADMIN_KEY） | cloudbaserc.json 本地注入，smoke 脚本运行时读取，不落库 | 部署流程 |

## 6. 待确认问题

1. **存储安全域名**：是否已/将在部署后开启 CloudBase 控制台「安全域名」与存储匿名读写？这是 P1-1 唯一外部依赖，配置前上传会失败（属预期，代码仍先行上线）。
2. **品牌文案口径**：HomePage 统一为「超柿」后的标语/底部文案具体措辞，需要用户给出口径；默认建议保持现有服务场景描述（如「宿舍楼下的小超市」类），未经确认前不引入新品牌主张。
3. **GitHub 仓库命名**：默认创建私有仓库 `supermarket-web` 并推送；如需其他名称/账号（本机还登录了 zhangguan176273-boop 副账号）请指定。
4. **成本数据录入**：costPrice 无历史数据，管理端后续录入；毛利率卡片上线初期预计为「待录入」态，是否符合预期？
5. **评价趋势数据形态**：云端 20 条种子评价无原始日期，导入时间即 createdAt，近 14 天趋势上线初期呈导入日单点；是否接受该形态（推荐接受，真实评价积累后自然分布）？

## 7. 结论

仓库处于健康可迭代状态：四项质量门禁全部通过，待办清单与计划逐项对齐，P1/P2 每项都有明确的代码改造锚点与验收口径，无隐藏技术债阻塞。主要不确定性集中在外部环境而非代码——存储安全域名配置、gh 符号链接、品牌文案口径三项需要用户侧配合，其余均可由团队按 P1-1 → P1-2 → P1-3 → P2-1 → P2-2 → 部署 → 推送的顺序完整落地。本次优化的本质不是功能堆叠，而是把评价写链路从「文档膨胀的 base64」迁移到「云存储 + fileID + 临时 URL」的可持续形态，同时把部署验证从「人工 curl」升级为「脚本化门禁」，并让看板从订单单视图走向「订单 + 评价 + 毛利」三视图。

## 8. 参考资料

[1] 项目交接文档: `supermarket-web/HANDOFF.md`（2026-08-08 全量上线记录）

[2] 项目记忆: `supermarket-web/memory/07-next-steps.md`（P0/P1/P2 行动项）

[3] 项目记忆: `supermarket-web/memory/05-feature-status.md`（功能实现状态）

[4] 项目记忆: `supermarket-web/memory/06-constraints.md`（已知约束与红线）

[5] 项目记忆: `supermarket-web/memory/08-ac-obs.md`（AC-OBS 验收标准）

[6] 服务端字段白名单: `supermarket-web/cloudfunctions/shared.js`（PRODUCT_FIELDS / REVIEW_FIELDS 单源）

[7] 客户端白名单: `supermarket-web/src/auth.ts`（PRODUCT_FIELDS 对称实现）

[8] 评价提交与压缩: `supermarket-web/src/pages/ProductDetailPage.tsx`（compressImage / handleSubmitReview）

[9] 看板实现: `supermarket-web/src/components/DashboardTab.tsx`（LineChart / DonutChart）

[10] 管理编辑: `supermarket-web/src/components/ProductsTab.tsx`（InlineEditForm）

[11] 评价管理接口: `supermarket-web/cloudfunctions/admin-api/index.js`（getAllReviews）

[12] 品牌与样式: `supermarket-web/src/pages/HomePage.tsx`、`supermarket-web/src/index.css`、`supermarket-web/index.html`

[13] 迁移脚本: `supermarket-web/scripts/migrate-ts.mjs`、`supermarket-web/scripts/repair-imports.mjs`

[14] 质量门禁实测输出: 2026-08-08 15:10-15:14 本机 `npm test` / `npm run typecheck` / `npm run lint` / `npm run build`
