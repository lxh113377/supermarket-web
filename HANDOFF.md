# 超柿 - 项目交接文档

> 最后更新：2026-08-28（架构已迁移 Cloudflare Pages + D1，README 为准；CloudBase 历史记录见文末存档）
>
> ✅ **最后实测验证：2026-09-05** —— main@9d803bd（含 CI env 注入修复），线上烘焙版正常（web/pub=True）、vitest 132/132、verify-backend 47/47。**ADMIN_KEY 已回退固定值**：09-05 轮换为随机串后用户拍板恢复 `supermarket-admin-****（掩码；真值见 .dev.vars / Pages secret）`（线上 secret + .dev.vars 同值，login code 0 实测通过）。**事故记录**：5 提交推送触发 CI 自动部署，因 ci.yml 缺 VITE_CB_API_BASE 注入产出未烘焙版（坑 27 复发）→ 已修 ci.yml（两处 Build step 注入 env）并手动部署烘焙版救火。优化建议与执行记录见 `../deliverables/optimization-recommendations-2026-09-05.md`。本文档中早于该日期的状态描述若与本戳冲突，**以本戳和磁盘实测为准**。

## 一、项目概述

"超柿"是一个面向宿舍/小区场景的在线超市购物系统，支持顾客浏览商品、加购下单、扫码支付，以及管理员后台管理商品、订单、看板、评价与服务表单。

- 管理后台 + API：`https://supermarket-web.pages.dev`（`/#/admin`）

- 微信顾客端：`https://lxh113377.github.io`

- 健康探活：`https://supermarket-web.pages.dev/_health`

## 二、当前技术栈

| 层级   | 技术                                                            |
| ---- | ------------------------------------------------------------- |
| 前端框架 | React 19 + Vite 8 + TypeScript（strict）                        |
| 样式   | Tailwind CSS 3                                                |
| 路由   | react-router-dom 7（HashRouter，页面全部懒加载）                        |
| 后端   | Cloudflare Pages Functions（`/web` 管理、`/pub` 公开、`/_health` 探活） |
| 数据库  | D1（SQLite，7 表）+ Workers KV（限流计数）                              |
| 双前端  | Cloudflare Pages（同源）/ GitHub Pages（dispatch CI 双发）            |
| Lint | oxlint                                                        |
| 测试   | vitest（63 文件 631 用例）+ `scripts/verify-backend.mjs`（后端契约 102 断言）+ Playwright 三层（`tests/e2e` 20 演示模式 / `tests/e2e-visual` 16 生产构建几何 / `tests/e2e-stub` 3 云端模式真渲染） |

## 三、项目结构

```
supermarket-web/
├── functions/              # Cloudflare Pages Functions
│   ├── web.js              # 管理 API：POST /web { action, adminKey, payload }
│   ├── pub.js              # 公开 API：POST /pub { action, payload }
│   ├── _health.js          # 探活：GET /_health
│   └── lib/
│       ├── backend.js      # 核心业务（鉴权/限流/审计/CORS/各 handler）
│       └── shared.js       # 前端/后端共用契约（字段白名单）
├── db/                     # D1 schema.sql / seed.sql / 迁移 SQL
├── src/
│   ├── main.tsx            # 入口，HashRouter + SW 注册 + 离线队列初始化
│   ├── App.tsx             # 路由表（全部懒加载 + Suspense）
│   ├── cloudbase.ts        # IS_CLOUD 判定（是否配置后端端点）
│   ├── db.ts               # 数据访问门面（再导出 db/ 子模块）
│   ├── auth.ts             # 管理端调用 + 字段白名单 + 缓存失效
│   ├── cart.ts             # 购物车纯函数（localStorage）
│   ├── localStore.ts       # 本地演示模式数据层
│   ├── catalogCache.ts     # 目录内存缓存（60s TTL）
│   ├── db/                 # products/orders/reviews/submissions/cloud/cloudInit
│   ├── hooks/              # useCart / useProducts
│   ├── utils/              # businessHours / reviewImages（评价图压缩+base64）
│   ├── components/         # UI 组件（含管理端 InlineEditForm 内联编辑）
│   └── pages/              # 顾客端 + 管理端页面
├── tests/                  # vitest 单测（18 文件 126 用例）
├── public/                 # 商品图 webp + sm/ 小图、sw.js、manifest、收款码
├── .github/workflows/      # ci.yml（门禁）+ dispatch.yml（github.io 双发）
├── wrangler.toml           # Pages 构建输出 + D1/KV 绑定
└── package.json
```

## 四、路由表

| 路径                        | 页面                | 说明                   |
| ------------------------- | ----------------- | -------------------- |
| `/#/`                     | HomePage          | 首页                   |
| `/#/shop`                 | CustomerPage      | 顾客商品列表               |
| `/#/category/:categoryId` | CategoryPage      | 分类页                  |
| `/#/service/:serviceId`   | ServiceFormPage   | 服务表单                 |
| `/#/product/:id`          | ProductDetailPage | 商品详情（多图+评价+写评价）      |
| `/#/cart`                 | CartPage          | 购物车                  |
| `/#/order-confirm`        | OrderConfirmPage  | 确认订单                 |
| `/#/order-success`        | OrderSuccessPage  | 下单成功                 |
| `/#/payment`              | PaymentPage       | 支付（扫码+轮询）            |
| `/#/admin`                | AdminPage         | 管理后台（需密钥，AdminGuard） |

## 五、本地开发

```bash
cd supermarket-web
npm install
cp .env.example .env   # 后端端点；本地密钥写 .dev.vars
npm run dev            # http://localhost:5173
npm run typecheck      # tsc --noEmit
npm run test           # vitest
npm run build          # 产物 dist/
node scripts/verify-backend.mjs   # 后端契约验证（mock D1）
```

无 `.env` 的 `VITE_CB_API_BASE` 时自动降级为本地演示模式（数据存 localStorage，不入库）。

## 六、部署

### Cloudflare Pages（管理后台 + API）

```bash
npm run build
npx wrangler pages deploy dist --project-name supermarket-web
```

- 密钥：Dashboard → Pages → supermarket-web → Variables and Secrets 新增 secret 型 `ADMIN_KEY`（与本地 `.dev.vars` 同值）；可选 `ADMIN_READONLY_KEY`（只读）

- D1/KV 绑定见 `wrangler.toml`

- **部署铁律**：任何 wrangler/deploy 操作前先加载 `chaoshi-web-deploy` skill，禁止裸跑；部署后用户需 `Ctrl+Shift+R` 强刷（SW 缓存，HTML 缓存 max-age=600 + SW 缓存最长 10min+）

### GitHub Pages（微信顾客端双发）

push main 后 `.github/workflows/dispatch.yml` 经 `GH_DISPATCH_TOKEN`（repo 权限 PAT）触发 `lxh113377.github.io` 的 Actions 重新构建发布（Pages 源 = GitHub Actions）。缺该 secret 时 dispatch job 失败。

### 部署冒烟（npm run smoke）

`scripts/smoke-deploy.mjs`（零依赖 Node fetch）：静态站 200 + `/web` getProducts + `/pub` getPublicProducts + `/_health`，全部 PASS 视为上线成功。

## 七、关键设计决策

### 7.1 安全

- 管理密钥不在前端代码；走 Pages secret（`ADMIN_KEY`）+ HTTP `/web` 校验

- AdminGuard 纯走接口验证，无本地哈希兜底

- `auth.ts` + 后端 `shared.js` 双端字段白名单（纵深防御）

- 订单金额服务端重算，前端不传 totalAmount

- 图片 scheme 白名单 `isSafeImageUrl`（拒绝 javascript:/data:text/html 注入）

- 限流优先 Workers KV（跨实例、可故障转移），KV 瞬时异常优雅回退 D1

- 登录限流在鉴权前计数（防暴力破解）；认证失败落 `security_events` 审计（仅密钥指纹）

- 双密钥角色：admin（全权限）/ readonly（禁止 `ADMIN_WRITE_ACTIONS`）

- CORS 精准白名单（pages.dev + github.io + 本地开发），`Vary: Origin`，可经 env 追加

### 7.2 数据层

- Cloudflare Pages Functions + D1（SQLite）；公开接口 `/pub`，管理 `/web`

- 顾客端读取带 60s 内存缓存（`catalogCache`），云端失败回退本地数据并 warn

- 商品/评价/服务查询 LIMIT 上限（1000/500/500）；订单分页（默认 50/页）

- 评价晒图 base64 dataURL 入 D1（≤3 图 × ≤800KB；技术债，量大后建议迁 R2 对象存储）

### 7.3 购物车

- 纯函数 + localStorage 持久化；useRef 解决 stale closure；storage 事件跨 tab 同步

### 7.4 商品图片

- `public/images/{order}.webp`（49 张原图）+ `sm/` 400w 响应式小图（srcset 接入）

- 管理后台可设自定义图片 URL（优先级高于本地编号图）；加载失败降级品牌色占位

### 7.5 评价系统

- 顾客提交（评分 1-5 钳制、昵称/文本截断、图片≤3×≤800KB、限流）+ 管理端增删

- 详情页合并云端 + 本地评价，fallback 种子评价

### 7.6 PWA

- Service Worker 仅缓存静态资源（JS/CSS/HTML/图片），API 请求不缓存

- build 时 `sw-version-inject` 自动 bump `CACHE_VERSION`（`dist/sw.js`）

- 发布后旧缓存最长 10min+ 影响验证，需新浏览器 profile + 强刷

## 八、Cloudflare 环境信息

| 项目         | 值                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Pages 项目   | supermarket-web（`supermarket-web.pages.dev`）                                                              |
| D1 数据库     | supermarket（id `4bfc0283-...`，binding `DB`）                                                               |
| Workers KV | RATE\_KV（id `47242e45-...`，限流计数）                                                                          |
| 管理密钥       | `ADMIN_KEY` = 64 位随机串（**2026-09-05 已轮换**，旧值 supermarket-admin-****（掩码；真值见 .dev.vars / Pages secret） 作废；生产 Pages secret 与本地 `.dev.vars` 同值） |
| 只读密钥       | `ADMIN_READONLY_KEY`（可选）                                                                                  |
| CORS 追加源   | `ALLOWED_ORIGINS`（逗号分隔，可选）                                                                                |

> 验密：`POST https://supermarket-web.pages.dev/web` `{action:"getSubmissions", adminKey}` 返回 code 0 即有效。

## 九、已知限制 & 后续建议

1. **评价晒图 base64 入 D1**（技术债 R7）— 量大后迁 Cloudflare R2 对象存储直传，backend 仅存 key
2. **无顾客账号体系** — 下单免登录，仅房间号+联系方式
3. **支付为模拟流程** — 展示收款码 + 轮询，未接真实支付 SDK
4. **无外部探活/告警** — `/_health` 已就绪，可接入 UptimeRobot 等免费探活
5. **批量操作** — 已支持后端批量端点（batchUpdateProducts/batchDeleteProducts）
6. **LIMIT 1000 容量边界** — 观测，日订单/商品增长后再评估

***

## 十、历史存档（CloudBase 时代，2026-08-08 前，仅归档参考）

> 以下记录为 2026-08-08 及之前的 CloudBase 架构历史，**已迁移至 Cloudflare Pages + D1，仅供参考勿照做部署**。

### 2026-08-08 全量上线（腾讯云 API 管家）

- 订单字段/评价体系/商品多图/数据卫生 + 41 文件 TS 迁移（strict 0 错误）

- tccli 授权 + `/pub → public-api` 独立路由 + hosting/fn 部署 + curl 验收

- 线上：sm\_products=49、sm\_reviews=20；SW 版本 sm-v1786129950705

- 坑：public-api 单独部署包需含 node\_modules；`tcb fn log` CLI 3.6.4 不可用

### 2026-07-25 会话 2（商品宣传图补齐）

- 4 agent 并行下载 49/49 官方宣传图（覆盖率 100%）；`scripts/verify_images.py` 验证

- 图源：苏宁易购约 35 张、gdyinjue/truly-fresh/腾讯新闻 CDN 少量

### 2026-07-25 会话 1（安全/逻辑）

- AdminGuard 删本地哈希兜底；PRODUCT\_FIELDS 白名单；订单金额服务端重算

- PaymentPage 轮询改 getOrderById；db.js 订单分页

