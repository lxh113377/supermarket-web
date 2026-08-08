# AGENTS.md — supermarket-web

> 自动生成: 2026-08-08 03:27:01


## 最近对话摘要
- 2026-08-08 — 完成超柿全量上线：P0/P1/P2 修复（订单字段/评价体系/多图/数据卫生）、41 文件 TS 迁移（97 测试全绿）、GUI 打磨、order20 换图（OCR 验证猎兽）。tccli 授权成功，创建 /pub→public-api 独立路由；部署发现 public-api 从未被 HTTP 调用、包内缺 node_modules → 补依赖后重部署解决。线上验证：49 商品、20 种子评价、测试订单/评价已清理。

---

# 01 - 项目目标

## 项目名称
supermarket-web

## 一句话描述
面向宿舍/小区场景的在线超市购物系统「超柿」——顾客浏览商品、加购下单、扫码支付，管理员后台管理商品、订单、评价与服务表单。

## 核心价值
解决小型社区购物场景：顾客无需到店即可下单；管理员一个后台完成商品维护、订单处理、数据看板与顾客评价管理。

## 当前阶段目标
- [x] P0/P1/P2 功能修复：订单字段落库、评价体系上云、商品多图、数据卫生
- [x] TypeScript 完整迁移（41 个 src 文件，0 类型错误）
- [x] GUI 定向打磨（品牌色统一、错误态、内联编辑、无障碍）
- [x] 腾讯云 API 管家上线部署（tccli 验证 + /pub 独立路由 + 全量部署 + curl 验收）

## 已完成目标
- [x] 基础购物链路（商品/购物车/订单/支付）可上线
- [x] 管理后台（商品/订单/看板/评价/服务表单）可上线
- [x] 2026-08-08 全量上线：49 商品、20 种子评价、独立 public-api 路由

---

# 02 - 仓库结构

```
├── .githooks/
│   └── pre-commit
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── archive/
│   └── 2026-08-08-migration-tools/
│       ├── migrate-ts.mjs
│       └── repair-imports.mjs
├── cloudfunctions/
│   ├── admin-api/
│   │   ├── index.js
│   │   ├── index.test.js
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   ├── seed-reviews.js
│   │   └── shared.js
│   ├── public-api/
│   │   ├── index.js
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   └── shared.js
│   └── shared.js
├── docs/
│   ├── cloudbase-js-sdk-database-subpath-bug.md
│   ├── CODE_REVIEW_PROCESS.md
│   ├── CODE_REVIEW_STANDARD.md
│   ├── db-index-guide.md
│   ├── oxlintrc.recommended.json
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── REVIEW_CHECKLIST.md
├── public/
│   ├── images/
│   │   ├── sm/
│   │   │   ├── 1.webp
│   │   │   ├── 10.webp
│   │   │   ├── 11.webp
│   │   │   ├── 12.webp
│   │   │   ├── 13.webp
│   │   │   ├── 14.webp
│   │   │   ├── 15.webp
│   │   │   ├── 16.webp
│   │   │   ├── 17.webp
│   │   │   ├── 18.webp
│   │   │   ├── 19.webp
│   │   │   ├── 2.webp
│   │   │   ├── 20.webp
│   │   │   ├── 21.webp
│   │   │   ├── 22.webp
│   │   │   ├── 23.webp
│   │   │   ├── 24.webp
│   │   │   ├── 25.webp
│   │   │   ├── 26.webp
│   │   │   ├── 27.webp
│   │   │   ├── 28.webp
│   │   │   ├── 29.webp
│   │   │   ├── 3.webp
│   │   │   ├── 30.webp
│   │   │   ├── 31.webp
│   │   │   ├── 32.webp
│   │   │   ├── 33.webp
│   │   │   ├── 34.webp
│   │   │   ├── 35.webp
│   │   │   ├── 36.webp
│   │   │   ├── 37.webp
│   │   │   ├── 38.webp
│   │   │   ├── 39.webp
│   │   │   ├── 4.webp
│   │   │   ├── 40.webp
│   │   │   ├── 41.webp
│   │   │   ├── 42.webp
│   │   │   ├── 43.webp
│   │   │   ├── 44.webp
│   │   │   ├── 45.webp
│   │   │   ├── 46.webp
│   │   │   ├── 47.webp
│   │   │   ├── 48.webp
│   │   │   ├── 49.webp
│   │   │   ├── 5.webp
│   │   │   ├── 6.webp
│   │   │   ├── 7.webp
│   │   │   ├── 8.webp
│   │   │   └── 9.webp
│   │   ├── 1.webp
│   │   ├── 10.webp
│   │   ├── 11.webp
│   │   ├── 12.webp
│   │   ├── 13.webp
│   │   ├── 14.webp
│   │   ├── 15.webp
│   │   ├── 16.webp
│   │   ├── 17.webp
│   │   ├── 18.webp
│   │   ├── 19.webp
│   │   ├── 2.webp
│   │   ├── 20.webp
│   │   ├── 20_old.webp
│   │   ├── 21.webp
│   │   ├── 22.webp
│   │   ├── 23.webp
│   │   ├── 24.webp
│   │   ├── 25.webp
│   │   ├── 26.webp
│   │   ├── 27.webp
│   │   ├── 28.webp
│   │   ├── 29.webp
│   │   ├── 3.webp
│   │   ├── 30.webp
│   │   ├── 31.webp
│   │   ├── 32.webp
│   │   ├── 33.webp
│   │   ├── 34.webp
│   │   ├── 35.webp
│   │   ├── 36.webp
│   │   ├── 37.webp
│   │   ├── 38.webp
│   │   ├── 39.webp
│   │   ├── 4.webp
│   │   ├── 40.webp
│   │   ├── 41.webp
│   │   ├── 42.webp
│   │   ├── 43.webp
│   │   ├── 44.webp
│   │   ├── 45.webp
│   │   ├── 46.webp
│   │   ├── 47.webp
│   │   ├── 48.webp
│   │   ├── 49.webp
│   │   ├── 5.webp
│   │   ├── 6.webp
│   │   ├── 7.webp
│   │   ├── 8.webp
│   │   └── 9.webp
│   ├── alipay.jpg
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icons.svg
│   ├── manifest.json
│   ├── sw.js
│   └── wechat-pay.png
├── scripts/
│   ├── check-import-cycles.mjs
│   ├── create-cloudbase-indexes.mjs
│   ├── gen_placeholder_images.py
│   ├── scan-secrets.mjs
│   └── verify_images.py
├── src/
│   ├── assets/
│   │   ├── hero.png
│   │   ├── react.svg
│   │   └── vite.svg
│   ├── components/
│   │   ├── AdminGuard.tsx
│   │   ├── CartItem.tsx
│   │   ├── DashboardTab.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── OrderItem.tsx
│   │   ├── OrdersTab.tsx
│   │   ├── ProductCard.tsx
│   │   ├── ProductsTab.tsx
│   │   ├── ReviewsTab.tsx
│   │   ├── SubmissionsTab.tsx
│   │   └── TopNav.tsx
│   ├── data/
│   │   ├── products-seed.ts
│   │   ├── reviews-seed.ts
│   │   └── services.ts
│   ├── db/
│   │   ├── cloud.ts
│   │   ├── cloudInit.ts
│   │   ├── orders.ts
│   │   ├── products.ts
│   │   ├── reviews.ts
│   │   └── submissions.ts
│   ├── hooks/
│   │   ├── useCart.ts
│   │   └── useProducts.ts
│   ├── pages/
│   │   ├── AdminPage.tsx
│   │   ├── CartPage.tsx
│   │   ├── CategoryPage.tsx
│   │   ├── CustomerPage.tsx
│   │   ├── HomePage.tsx
│   │   ├── OrderConfirmPage.tsx
│   │   ├── OrderSuccessPage.tsx
│   │   ├── PaymentPage.tsx
│   │   ├── ProductDetailPage.tsx
│   │   └── ServiceFormPage.tsx
│   ├── utils/
│   │   └── businessHours.ts
│   ├── App.tsx
│   ├── auth.ts
│   ├── cart.ts
│   ├── catalogCache.ts
│   ├── cloudbase.ts
│   ├── db.ts
│   ├── index.css
│   ├── localStore.ts
│   ├── main.tsx
│   └── types.ts
├── tests/
│   ├── authWhitelist.test.js
│   ├── businessHours.test.js
│   ├── cart.test.js
│   ├── catalogCache.test.js
│   ├── dbFacade.test.js
│   └── shared.test.js
├── tmp/
│   └── 20cand/
│       ├── 20_cutout.png
│       ├── 20_processed.png
│       ├── cand2.jpg
│       ├── cand3.jpg
│       ├── cand4.jpg
│       ├── cand5.jpg
│       ├── cand6.jpg
│       ├── cand7.jpg
│       └── current20.png
├── .env
├── .env.example
├── .oxlintrc.json
├── cloudbaserc.json
├── HANDOFF.md
├── index.html
├── package-lock.json
├── package.json
├── postcss.config.js
├── README.md
├── tailwind.config.js
├── tsconfig.json
└── vite.config.js
```

## 模块说明
- `src/` — 
- `tests/` — 

---

# 03 - 技术栈

### 语言: JavaScript/TypeScript (Node.js)
### 运行时: Node.js 未指定
### 框架: React ^19.2.7
### 构建工具: Vite
### 关键依赖:
  - @cloudbase/cli: ^3.6.4
  - @cloudbase/js-sdk: ^3.6.4
  - @cloudbase/node-sdk: ^3.18.3
  - autoprefixer: ^10.5.4
  - oxlint: ^1.71.0
  - postcss: ^8.5.22
  - react-dom: ^19.2.7
  - react-router-dom: ^7.18.1
  - tailwindcss: ^3.4.19
  - vitest: ^4.1.10

## 构建与部署
- 构建： 
- 部署： 

## 运行时要求

---

# 04 - 核心文件地图

### 入口文件:
  - `cloudfunctions/admin-api/index.js`
  - `cloudfunctions/public-api/index.js`
  - `src/App.tsx`
### 配置文件:
  - `package.json`
  - `tsconfig.json`
  - `vite.config.js`
  - `.env`
  - `.env.example`
  - `tailwind.config.js`
### 文档: `README.md`

## 核心逻辑文件
- `` — 

## 配置文件
- `` — 

---

# 05 - 功能状态

## ✅ 已实现
- [x] 顾客购物链路 — 商品浏览/搜索/加购/下单/支付轮询，房间号+联系方式+备注+付款截图落库
- [x] 订单服务端重算 — createOrder 服务端计价防篡改，items 冗余 subcategories（看板分类占比修复）
- [x] 评价体系 — addPublicReview 公开提交（评分 1-5 钳制、昵称/文本截断、图片≤5张≤2MB、限流），云端优先+本地降级
- [x] 种子评价 — seedReviews 幂等管理 action，线上已导入 20 条（覆盖 15 个商品）
- [x] 商品多图 — PRODUCT_FIELDS 含 images，详情页轮播，管理端内联编辑多图 URL/主图/排序
- [x] 数据卫生 — 移除前端错误上报污染 sm_submissions；public-api 商品上限 1000
- [x] TypeScript 迁移 — 41 个 src 文件全部 .ts/.tsx，strict 模式 0 错误
- [x] GUI 打磨 — SubmissionsTab 品牌色、HomePage 渐变、CustomerPage 重试按钮、内联错误文案、aria-label
- [x] 商品图修正 — order20 从错误的东鹏特饮广告图替换为 OCR 验证的猎兽 PREDATOR 500ml 白底抠图
- [x] 全量上线 — hosting 128 文件 + admin-api/public-api 云函数 + /pub 独立 HTTP 路由（tccli 创建）

## 🚧 开发中

## 📋 计划中
- 📋 评价晒图改云存储直传（当前为 base64 入库，最大 5 张 × 2MB，量大后建议 COS 临时签名直传）
- 📋 顾客账号体系（当前匿名登录关闭，下单免登录，仅房间号+联系方式）
- 📋 部署自动化脚本（密钥注入/占位符还原/双函数冒烟测试一键化）

---

# 06 - 已知约束

## 已知 Bug
- [BUG] public-api 若被单独重新部署，包内必须含 node_modules（@cloudbase/node-sdk），否则 FUNCTIONS_INVOCATION_FAILED — 影响：/pub 全部公开接口 | 状态：已修复（2026-08-08 补依赖重部署），部署流程已记录
- [BUG] tcb fn log 在 CLI 3.6.4 返回"当前版本不支持更多日志检索" — 影响：线上排障 | 状态：未修复（改用控制台日志服务）

## 技术债
- [DEBT] 评价晒图 base64 入库（≤5×2MB） — 建议云存储直传，减少文档体积
- [DEBT] src/cloudbase.ts 等平台边界用 any — 已注释说明，保持平台边界宽松

## 红线（不能改）
- 部署任何 tcb hosting/fn deploy 前必须先加载 chaoshi-web-deploy skill，禁止凭记忆裸跑
- cloudbaserc.json 只保留 ${ADMIN_KEY} 占位符，禁止明文密钥入库（文件已 gitignore）
- 管理后台商品编辑禁弹窗/抽屉，唯一交互为 InlineEditForm 内联展开
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）
- .env 不打印/不回显任何密钥

## 性能/兼容性约束
- 商品图 WebP（quality 80）+ sm/ 400w 小图，移动端列表页省流量
- public-api 商品查询上限 1000 与 admin 对齐
- 前端 Service Worker 缓存静态资源，发布后需强刷（SW 版本自动 bump）

---

# 07 - 下一步

## P0 — 必须做
- [ ] 线上全链路人工验收 — 用户 Ctrl+Shift+R 强刷后走通 首页→详情(order20 猎兽图+评价)→加购→下单→支付→管理后台；验证 seed 的 20 条评价可见
- [ ] 观察线上运行 3-7 天 — 关注 sm_orders/sm_reviews 计数与 public-api /pub 调用是否稳定（日志 Topic: tcb-topic-chaoshi-d2g5xfkao100010ef）

## P1 — 应该做
- [ ] 评价晒图改云存储直传 — 用 @cloudbase/js-sdk uploadFile + 临时签名 URL 替代 base64 入库，注意先配安全域名
- [ ] 部署冒烟脚本化 — 把"fn deploy 后立即 curl/fn invoke 两个函数"写进 chaoshi-web-deploy skill 或 scripts/，防 public-api 类静默失败
- [x] 清理迁移脚本 — 2026-08-08 已归档至 archive/2026-08-08-migration-tools/（可恢复，未硬删）

## P2 — 可以做
- [ ] 绑定自定义域名 + HTTPS 证书（当前用默认域名）
- [ ] 数据看板增强（评价趋势、分类毛利率）
- [ ] CloudBase 日志检索接入（当前 tcb fn log 在 CLI 3.6.4 不可用，改控制台或 tccli）

## 最近对话摘要
- 2026-08-08 — 完成超柿全量上线：P0/P1/P2 修复（订单字段/评价体系/多图/数据卫生）、41 文件 TS 迁移（97 测试全绿）、GUI 打磨、order20 换图（OCR 验证猎兽）。tccli 授权成功，创建 /pub→public-api 独立路由；部署发现 public-api 从未被 HTTP 调用、包内缺 node_modules → 补依赖后重部署解决。线上验证：49 商品、20 种子评价、测试订单/评价已清理。

## 已完成
- [x] 阶段一~四：功能修复 + TS 迁移 + 测试门禁（97 passed / lint 0 error / typecheck 0 / build ✓）
- [x] 阶段五：order20 换图 + VITE_CB_PUBLIC_API_BASE=/pub + 构建
- [x] 阶段六：tccli 只读验证 + CreateHTTPServiceRoute + hosting/fn 部署 + curl 验收 + seed 20 条

---

# 08 - AC-OBS 验收标准

## 验收标准列表
- [x] AC-OBS-01: 单元测试全绿 → npm test 97 passed | 测试输出
- [x] AC-OBS-02: 类型检查 0 错误 → npm run typecheck | 测试输出
- [x] AC-OBS-03: 构建成功且 SW 版本 bump → npm run build 输出 ✓ built + [sw-version] | 测试输出
- [x] AC-OBS-04: public-api 独立路由可用 → POST /pub getPublicProducts 返回 code 0 + 49 商品 | API响应
- [x] AC-OBS-05: 管理接口可用 → POST /web getOrders/getProducts 带 adminKey 返回 code 0 | API响应
- [x] AC-OBS-06: 种子评价入库 → seedReviews 返回 added=20，tccli DescribeTables sm_reviews=20 | API响应 + 数据库查询
- [x] AC-OBS-07: 顾客评价与下单写链路 → /pub addPublicReview、createOrder 均 code 0，测试数据已删除 | API响应
- [x] AC-OBS-08: 静态站上线 → https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com HTTP 200 + 新 bundle | API响应
- [ ] AC-OBS-09: 浏览器人工验收 → 强刷后走通全链路，order20 显示猎兽图 + 评价可见 | 截图
