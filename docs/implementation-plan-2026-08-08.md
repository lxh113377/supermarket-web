# 超柿 Web 优化实施计划（2026-08-08）

> 架构师：高见远。输入：PM 许清楚《optimization-report-2026-08-08.md》（全实测数据）+ HANDOFF + memory/07 + 源码逐文件取证。本计划只描述「做什么、改哪些文件、按什么顺序、接口怎么变、怎么验」，实现归工程师寇豆码，部署归 QA 严过关。

## 0. 总原则

- 不引入任何新依赖（MUI / 图表库 / fetch 库均禁止），全部复用现有 Vite + React 19 + Tailwind 3 + CloudBase SDK。
- 不改品牌色、不做全面视觉改版；管理后台商品编辑唯一交互 = ProductsTab 内联 InlineEditForm（禁弹窗/抽屉）。
- 工作区存在既有未提交改动（TS 迁移 41 个重命名 + 57 个文件未暂存）——工程师只增量修改，禁止回滚/覆盖既有改动。
- .env / cloudbaserc.json 不回显、不打印、不提交；cloudbaserc.json 部署后必须还原 `${ADMIN_KEY}` 占位符。
- 所有云函数改 shared.js 后必须 `npm run predeploy` 同步两份副本（admin-api/public-api）。

## 1. 实现顺序与依赖

```
P1-3 归档迁移脚本（零依赖，最先做，最快见效）
  ↓
P1-1 评价晒图云存储直传（独立，工作量最大，先改）
  ↓
P1-2 冒烟脚本化（独立，可并行）
  ↓
P2-1 看板增强（依赖 costPrice 三处白名单同步 + 数据流，工作量第二大）
  ↓
P2-2 两端 GUI 定向优化（独立，最后做视觉类收尾）
  ↓
门禁四连：npm test → typecheck → lint → build（SW 自动 bump）
  ↓
QA：全量部署模式 C + 冒烟 + tccli 复核
```

P1-2 与 P1-1 无相互依赖，工程师可在 P1-1 等待期间并行落 P1-2；P1-3 随时可先做。

---

## 2. P1-3 清理迁移脚本（先做）

### 改动

| 文件 | 操作 | 说明 |
|---|---|---|
| `scripts/migrate-ts.mjs` | 移动 | → `archive/2026-08-08-migration-tools/migrate-ts.mjs` |
| `scripts/repair-imports.mjs` | 移动 | → `archive/2026-08-08-migration-tools/repair-imports.mjs` |
| `AGENTS.md` | 修改 | 目录树/相关条目路径改为 archive 相对路径 |
| `memory/02-structure.md` | 修改 | 同上去路径 |
| `memory/07-next-steps.md` | 修改 | P1 项勾选并注明归档路径 |

已取证：两脚本仅被文档（AGENTS.md、memory/02-structure.md、memory/07）与彼此引用，package.json / src / public 零引用；移动不破坏任何构建与测试。

### 验收

- `scripts/` 下两脚本消失；`archive/2026-08-08-migration-tools/` 存在且含两文件（可恢复，不硬删）。
- `git status` 可见移动记录；`npm run lint` 不再对这两脚本报 console warning（若 lint 仍扫 archive，接受 0 error 即可，warning 不阻塞）。

---

## 3. P1-1 评价晒图云存储直传（核心）

### 3.1 接口与行为定义

1. 图片压缩逻辑不变（canvas 最大边 800px、quality 0.6、≤2MB、≤5 张），但压缩产物同时产出 `{ dataUrl, blob }`：dataUrl 仅供本地预览（现有 UI 零改动），blob 用于上传。
2. 上传路径：`app.uploadFile({ cloudPath: 'reviews/{ts}-{rand}.{ext}', filePath: blob })`；`ts = Date.now()`，`rand = Math.random().toString(36).slice(2, 8)`，`ext` 由 `file.type` 映射（jpeg→jpg、png→png、webp→webp、其余→jpg）。
3. `review.images` 存 `fileID`（`cloud://...`），服务端 REVIEW_FIELDS / 5 张上限 / 2MB 单串校验一律不动（fileID 字符串远小于 2MB，天然兼容）。
4. 渲染端：`review.images` 批量解析临时 URL——`app.getTempFileURL({ fileList: fileIDs })`；带会话级缓存（模块级 Map，TTL 90 分钟，短于临时 URL 有效期，防过期图）；旧 `data:` / `http(s):` / 相对路径图片直出兼容。
5. 付款截图维持 base64 不动（createOrderHandler 不碰）。
6. 上传失败处理：任一图片上传失败 → 中止提交，提示「图片上传失败：请检查云存储配置后重试」（配置前属预期；无图评价不受影响，正常提交）。

### 3.2 文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `src/utils/reviewImages.ts` | 新增 | `compressImage(file) → { dataUrl, blob }`；`uploadReviewImages(blobs) → fileIDs[]`；`resolveReviewImages(images, deps) → urls[]`（依赖注入 resolver 便于单测）；会话缓存 `Map<fileID,{url,expiresAt}>`；`fileExt(type)` 纯函数导出 |
| `src/pages/ProductDetailPage.tsx` | 修改 | 引入上述工具；`reviewImages` 状态旁增 `reviewImageBlobs` 平行数组（增删同步）；提交前先上传再 `addReview(fileIDs)`；评价图渲染前经 `resolveReviewImages`；轮播图 onError 从「单布尔」改为「按 index 记录」，失败图走 Placeholder；评价缩略图 onError 隐藏 |
| `index.html` | 修改 | CSP 放行云存储：`img-src 'self' data: blob: https://*.tcb.qcloud.la https://*.myqcloud.com;`；`connect-src` 追加 `https://*.tcb.qcloud.la https://*.myqcloud.com`（追加不删原有） |
| `tests/reviewImages.test.ts` | 新增 | 纯逻辑：fileID 判定（`cloud://` 前缀）、data/http 直出兼容、缓存命中/过期、ext 映射、批量解析保持原顺序 |

不改动：`cloudfunctions/shared.js`（addReviewHandler 校验天然兼容 fileID）、`src/db/reviews.ts`（addReview 签名不变，images 数组内容从 dataURL 变 fileID，pickReviewFields 不变）、`cloudfunctions/admin-api/index.js`、`cloudfunctions/public-api/index.js`。

### 3.3 风险与回滚

- 外部依赖：CloudBase 控制台「安全域名 + 存储匿名读写」未配置前上传必失败 → 代码先上线，错误文案明确；配置后即用，无需再改代码。
- CSP 改动为「追加放行」而非替换，data:/blob: 保留，历史 base64 图不受影响；若上线后发现图裂，先查 CSP 是否缺域名，回滚只需还原 index.html。
- 临时 URL 过期 → 缓存 TTL 90min 兜底；个别过期图仅该图裂，不影响提交。
- 回滚：git revert 本阶段改动即可恢复 base64 直传（旧数据与新数据并存，渲染端双向兼容，无数据迁移）。

---

## 4. P1-2 部署冒烟脚本化

### 4.1 文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `scripts/smoke-deploy.mjs` | 新增 | 零依赖 Node 原生 fetch；四项检查各输出 PASS/FAIL：① 静态站 GET `/` HTTP 200 且含 `id="root"`；② `/web` getOrders（带 adminKey）code 0；③ `/web` getProducts code 0；④ `/pub` getPublicProducts code 0。全过 exit 0，任一失败 exit 1 并打印失败明细 |
| `package.json` | 修改 | scripts 增 `"smoke": "node scripts/smoke-deploy.mjs"` |
| `HANDOFF.md` | 修改 | 补「部署冒烟」小节：`npm run smoke` 用法与前置（ADMIN_KEY 注入说明） |

密钥解析优先级（禁硬编码）：`process.env.ADMIN_KEY` → `cloudbaserc.json` 的 `envVariables.aDMIN_KEY`（仅当其值不是 `${ADMIN_KEY}` 占位符时）。端点解析：`process.env.API_BASE` / `PUBLIC_API_BASE` → `.env` 的 `VITE_CB_API_BASE` / `VITE_CB_PUBLIC_API_BASE` → 内置默认 tcloudbase 域名。脚本不得输出密钥本身。

### 4.2 验收

- `node scripts/smoke-deploy.mjs` 本地（配置 env）四项全 PASS；
- 部署后 QA 在注入密钥窗口期跑 `npm run smoke` 全 PASS；密钥还原后仍可用 `$env:ADMIN_KEY=...` 重跑。
- 不改 chaoshi-web-deploy skill 主体（skill 只做指针性提示）。

---

## 5. P2-1 管理看板增强

### 5.1 costPrice 字段三处白名单同步（同一次提交内完成）

| 文件 | 操作 | 要点 |
|---|---|---|
| `cloudfunctions/shared.js` | 修改 | `PRODUCT_FIELDS` 在 `'price'` 后插入 `'costPrice'`（服务端单源）；改后必须 `npm run predeploy` |
| `src/auth.ts` | 修改 | 客户端 `PRODUCT_FIELDS` 同位置插入 `'costPrice'`（与 authWhitelist.test.js 的精确数组断言同步更新） |
| `src/types.ts` | 修改 | `Product` 增 `costPrice?: number` |
| `src/components/ProductsTab.tsx` | 修改 | `ProductForm` 增 `costPrice: string`；`emptyForm` 默认 `''`；InlineEditForm 初始化 `product.costPrice ?? ''`；价格输入旁新增「成本价（可选）」`<input type="number" step="0.01" min="0">`（仍内联，禁弹窗/抽屉红线不变）；保存时：空串→`undefined`（不落库），数字→`Math.round(Number(v)*100)/100`，NaN→表单错误提示 |
| `tests/authWhitelist.test.js` | 修改 | 两处：精确数组断言加 `'costPrice'`；新增「costPrice 透传」用例（数字保留两位、空串不落字段、NaN 拒绝由表单层处理） |
| `cloudfunctions/admin-api/index.test.js` | 修改 | 若该文件含 PRODUCT_FIELDS 精确断言则同步；新增 updateProduct costPrice 白名单透传用例 |

服务端 `createProduct`/`updateProduct` 走 `pickFields(pl, PRODUCT_FIELDS)`，加字段后自动透传；历史商品无 costPrice 不受影响（可选字段）。

**显式约束**：`getPublicProducts` 的 `.field({...})` 白名单保持现状、不得加入 costPrice——成本是内部经营数据，禁止对顾客端公开。

### 5.2 DashboardTab 两张新卡

| 文件 | 操作 | 要点 |
|---|---|---|
| `src/components/DashboardTab.tsx` | 修改 | props 由 `{ orders }` 扩为 `{ orders, products, reviews }`；导出两个纯函数（供单测）：`buildReviewTrend(reviews, days=14)` 与 `computeGrossMargin(orders, products)`；新增「近 14 天评价趋势」卡（复用 LineChart，空数据显示「暂无数据」）与「饮品/食品毛利率」卡 |
| `src/pages/AdminPage.tsx` | 修改 | `products` 已加载；增 `reviews` state；`tab==='dashboard'` 时 `getAllReviews()`（db/reviews 已存在该 API，limit 1000）；`<DashboardTab orders={orders} products={products} reviews={reviews} />` |
| `tests/dashboard.test.ts` | 新增 | 覆盖：空数据、14 天窗口边界（今天/昨天/第 14 天）、无成本商品（返回 null + 待录入标记）、0 销量、商品匹配（productId 优先，name+spec 兜底）、毛利率公式 `(revenue-cost)/revenue*100` 取整 |

纯函数行为定义：

- `buildReviewTrend(reviews, days=14)`：以本地日界聚合 `createdAt`（无 createdAt/非法日期跳过，兼容 20 条种子评价导入日单点）；返回 `{ counts: number[14], labels: string[14] }`（今天为末位，labels 格式 `M/D`）。
- `computeGrossMargin(orders, products)`：遍历非 cancelled 订单 items；按 `productId`（兜底 `name+spec`）匹配商品；仅统计 `costPrice` 已填的商品，`revenue += price*qty`、`cost += costPrice*qty`；返回 `{ drink: {revenue,cost,marginPct} | null, food: {...} | null, withCostItems, totalItems }`；`withCostItems===0` 时两卡均 null，UI 显示「待录入」。
- 饮品/食品判定沿用现有 `drinkSubs` 集合（low_sugar/vitamin/energy/tea/soda/sweet/water），无子分类归饮品（与现状一致）。

### 5.3 验收

- 管理端商品内联编辑可录入成本价，保存后云端商品文档含 costPrice（getProducts 返回可见）；
- 看板两新卡与现有卡片视觉同构（`bg-white rounded-2xl border-gray-100/80 shadow-card animate-fade-in-up` + `section-title`）；
- 新单测全绿，`npm run lint` 0 error。

---

## 6. P2-2 两端 GUI 定向优化

### 6.1 顾客端

| 文件 | 操作 | 要点 |
|---|---|---|
| `src/pages/HomePage.tsx` | 修改 | 主标题「江科校园服务」→「超柿」（与 index.html title 统一）；副标题与底部文案保持现有服务场景描述（不引入新品牌主张，用户确认口径后再调）；分类卡片补 `aria-label={`查看${cat.name}`}` |
| `src/App.css` | 删除 | 已取证零引用（main.tsx 仅 import index.css；全仓 rg 无 App.css）；删除同时更新 AGENTS.md / memory/02-structure.md 目录树里的 App.css 行 |
| `src/index.css` | 修改 | ① 移动端输入防缩放：`@media (max-width: 640px) { input, select, textarea { font-size: 16px !important; } }`；② `-webkit-touch-callout: none` 加到 `img`（微信长按图片不弹菜单）；③ 新增 `.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }` |
| 各 fixed bottom 容器 | 修改 | 给所有 `fixed bottom-0` 栏（ProductDetailPage 底部加购栏、CartPage、PaymentPage、ProductsTab 批量操作栏等，用 `rg "fixed bottom-0"` 枚举）追加 `.safe-bottom`，适配 iPhone 底部安全区 |
| `src/pages/ProductDetailPage.tsx` | 修改 | 见 §3.2：轮播图按 index 记错误、评价图失败隐藏、缩略图 onError 占位 |
| aria-label 补齐 | 修改 | CategoryPage 分类卡片、AdminPage 纯图标按钮、OrderSuccessPage 操作按钮、ServiceFormPage 无文本按钮——以 `rg "<button"` 逐个审计，无文本且无 aria-label 的补 `aria-label`（语义不重复） |

### 6.2 管理后台

| 文件 | 操作 | 要点 |
|---|---|---|
| `src/components/OrdersTab.tsx` | 修改 | props 增 `loading?: boolean`；`orders.length===0 && loading` 显示骨架/spinner（复用现有 `animate-spin` 样式），替代直出「暂无订单」 |
| `src/pages/AdminPage.tsx` | 修改 | `<OrdersTab loading={loading} ... />`（初始加载态已有） |
| `src/components/OrdersTab.tsx` / `ReviewsTab.tsx` / `SubmissionsTab.tsx` | 修改 | 表格外层加 `overflow-x-auto`，内层 `min-w-[560px]`（移动端横向可读） |
| `ProductsTab.tsx` | 不改交互 | 仅 §5.1 的成本输入；红线保持 |

### 6.3 验收

- iOS/微信内置浏览器：输入聚焦不缩放、底部无黑条、长按图片不弹菜单；
- 详情页任一轮播图失败只坏该图（切换不残留错误态）；评价 fileID 图与历史 base64 图均正常显示；
- OrdersTab 加载中不闪「暂无订单」；三张表格手机宽度可横滑不挤压；
- 无文本按钮全部有 aria-label；`npm run lint` 0 error。

---

## 7. 测试与门禁（工程师交付前自检）

### 7.1 新增/修改测试汇总

| 测试文件 | 内容 |
|---|---|
| `tests/reviewImages.test.ts` | 新增：fileID 判定、data/http 直出、缓存 TTL、ext 映射、批量解析顺序 |
| `tests/dashboard.test.ts` | 新增：buildReviewTrend 空/边界；computeGrossMargin 空订单/无成本/0 销量/匹配兜底/公式 |
| `tests/authWhitelist.test.js` | 修改：PRODUCT_FIELDS 精确断言 + costPrice 透传 |
| `cloudfunctions/admin-api/index.test.js` | 修改：若含精确断言则同步；costPrice 白名单透传 |

现有 97 单测必须保持全绿（精确数组断言会因白名单变更失败，属预期更新而非回归）。

### 7.2 门禁顺序

```
npm test        → 全部通过（旧 97 + 新增）
npm run typecheck → 0 错误（新 utils 用 TS 写）
npm run lint    → 0 error
npm run build   → ✓ built + 输出含 [sw-version] 行
```

工程师完成后回传 IS_PASS 声明（四项门禁输出贴摘要），再交 QA。

---

## 8. 部署前置（QA 阶段，本计划只定接口）

- QA 按 chaoshi-web-deploy SKILL.md V2.3.0 全量模式 C 执行：Step 0 预检 → tccli 只读 DescribeEnvs / DescribeHTTPServiceRoute（确认 /web、/pub）→ Step 7 密钥注入（PowerShell 字面量 `.Replace`）→ hosting deploy → predeploy → `echo y | fn deploy` ×2 → 还原占位符 → curl 双端点 + `/pub` → tccli DescribeTables 复核 sm_reviews。
- 冒烟：部署期间（密钥注入窗口）跑 `npm run smoke`；密钥还原后用 `$env:ADMIN_KEY` 重跑一次，验证脚本两条取密钥路径都通。
- P1-1 外部依赖提醒：CloudBase 控制台「安全域名 + 存储匿名读写」由用户在部署后配置，配置前评价晒图上传报错属预期。

---

## 9. 风险登记与回滚总表

| 风险 | 等级 | 缓解/回滚 |
|---|---|---|
| 存储安全域名未配置（唯一外部依赖） | 高 | 代码先行；错误文案明确；配置后即用 |
| CSP 放行域名不完整导致云图裂 | 高 | 追加式放行不删旧；上线后 curl/浏览器验证；回滚 index.html 即可 |
| 白名单精确断言测试失败 | 中 | 同提交同步更新三处（shared/auth/tests） |
| costPrice 类型/精度问题 | 中 | 表单层两位小数规整；服务端透传原值；历史商品无字段不报错 |
| 种子评价 createdAt 单点 | 低 | 接受；真实评价积累后自然分布 |
| 工作区既有改动被误回滚 | 中 | 工程师只增改白名单文件清单内路径；commit 前 diff 核对 |
| 临时 URL 过期 | 低 | 缓存 TTL 90min；单图过期不阻塞 |

回滚路径：前端/文档改动 `git checkout -- <文件>` 或 revert 单阶段 commit；云函数改动走控制台版本回退 + 本地 `npm run predeploy` 后 `tcb fn deploy`；云端密钥紧急修复走控制台环境变量。
