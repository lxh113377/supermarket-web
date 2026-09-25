# 超柿 Web（supermarket-web）

面向宿舍/小区场景的在线超市购物系统。顾客端浏览商品、加购下单、扫码支付；管理后台管理商品、订单、评价与服务表单。

![CI](https://github.com/lxh113377/supermarket-web/actions/workflows/ci.yml/badge.svg)
![tests](https://img.shields.io/badge/tests-176%20passed-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

**文档**：[架构文档](docs/ARCHITECTURE.md) · [API 契约（人读版）](docs/API.md) · [决策记录 ADR](docs/adr/) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [更新日志](CHANGELOG.md)

## 功能一览

| 端 | 功能 |
|---|---|
| 顾客端 | 首页 / 分类 / 商城 / 商品详情 / 购物车 / 确认订单 / 支付页 / 下单成功 / 服务表单 / AI 导购 |
| 管理后台 | 数据看板（echarts）/ 商品管理（内联编辑）/ 订单管理 / 评价管理 / 服务表单处理 |
| 后端 | `/web` 管理 30 action、`/pub` 公开 8 action、`/_health` 探活；D1 + KV；限流 / 审计 / 双密钥角色 |
| 履约 | 订单 5 态状态机（待支付→已支付→配送中→已送达，旁路已取消）；顾客侧 `/pub getOrderStatus` 进度轮询 |
| PWA | 可安装（含微信与 iOS 手动引导）、Service Worker 缓存静态资源 |

- **前端**：React 19 + Vite 8 + TypeScript + Tailwind CSS 3 + react-router 7（HashRouter）
- **后端**：Cloudflare Pages Functions（`/web` 管理、`/pub` 公开、`/_health` 探活）+ D1（SQLite）+ Workers KV（限流）
- **双前端**：Cloudflare Pages（管理后台 + API，同源）/ GitHub Pages（微信顾客端，跨源调 pages.dev）
- **支付**：展示微信/支付宝收款二维码（模拟流程，未接真实支付 SDK）

## 网址

- 管理后台 + API：`https://supermarket-web.pages.dev`（`/#/admin` 后台）
- 微信顾客端：`https://lxh113377.github.io`（备用镜像）
- 健康探活：`https://supermarket-web.pages.dev/_health` → `{status:"ok", db:"ok"}`

## 本地开发

```bash
cd supermarket-web
npm install
cp .env.example .env   # 填入后端端点；本地后端密钥写 .dev.vars（勿提交）
npm run dev            # http://localhost:5173
```

无 `.env` 的 `VITE_CB_API_BASE` 时自动降级为本地演示模式（数据存 localStorage）。

### 管理端「云端模式」的浏览器验收（不需要生产密钥）

演示模式进不了云端分支（看板聚合在服务端，demo 下会显示"看板数据加载失败"），而用生产密钥做浏览器验收等于把密钥写进对话/日志——禁止。为此提供一条隔离通道：

```bash
npm run build:stub   # 用 tests/env-stub/.env.stub 烘焙同源端点（/web、/pub）
npm run serve:stub   # http://localhost:5182，静态伺服 dist-stub + 假 /web /pub 响应
```

密钥随便填（假桩一律放行），即可在真浏览器里跑「登录 → 看板 → 真 echarts 出图」这条路径（六轮的 canvas 正反例就是这么做出来的）。⚠️ 该产物严禁上线。

## 部署

### Cloudflare Pages（管理后台 + 后端 API）

```bash
npm run build
npx wrangler pages deploy dist --project-name supermarket-web
```

- 后端密钥：Cloudflare Dashboard → Pages → supermarket-web → Settings → Variables and Secrets 新增 secret 型 `ADMIN_KEY`（本地开发用 `.dev.vars`，已被 gitignore）
- D1/KV 绑定见 `wrangler.toml`（DB / RATE_KV）
- 部署后用户需 `Ctrl+Shift+R` 强刷（SW 缓存）

### GitHub Pages（微信顾客端双发）

push main 后 `.github/workflows/dispatch.yml` 经 `GH_DISPATCH_TOKEN` 触发 `lxh113377.github.io` 的 Actions 重新构建发布（Pages 源 = GitHub Actions）。缺该 secret 时 dispatch job 失败。

## CI

`.github/workflows/ci.yml` 的 Test job 依序跑：**依赖漏洞审计**（`npm audit`，见下）→ 密钥扫描 → oxlint → vitest（**631 用例 / 63 文件**，带 v8 覆盖率并卡棘轮阈值 78/72/74/80）→ typecheck（前后端双配置）→ 循环依赖检查 → API 契约漂移 → **schema 漂移** → **license 白名单** → **CHANGELOG 门禁** → build（注入线上端点）→ 体积预算 → 后端契约验证（`scripts/verify-backend.mjs`，**102 断言**，node:sqlite 模拟 D1）。

依赖审计固定走官方源（`npm run audit:deps`）：本机/镜像源 npmmirror **未实现 audit 端点**（实测 `NOT_IMPLEMENTED`），不指 registry 会让审计静默拿不到数据；端点故障时 npm audit 非 0 退出，不会假绿。

push main 后 `deploy` job：部署 Cloudflare Pages → 线上冒烟（`_health` + 公开接口契约）→ **冒烟失败自动回滚上一生产部署**。另有 `dispatch.yml`（github.io 顾客端双发）与 `uptime.yml`（每日探活）。

CI 另外两道卡口：**体积预算**（`scripts/check-bundle-size.mjs`，按首屏 gzip 卡阈值：JS ≤95KB / CSS ≤11KB / 单 chunk ≤90KB，并打印首屏构成 top3 便于归因；基线归因见 `docs/adr/0004`）与 **浏览器层两道门禁**：

- `e2e` job：`tests/e2e/`，Playwright **20 用例**跑在 dev server 的本地演示模式。
- `e2e-cloud-stub` job：`tests/e2e-stub/`，Playwright **3 用例**跑 `build:stub` 生产构建 + 假 `/web` `/pub` 桩，进云端模式断看板四张图真的建出 canvas 且零未捕获异常（防线轮 K2 新增，专防"单测全绿而线上静默空白"那类缺陷）。

两者自本轮起都列入 `deploy.needs`（此前只有 `build-and-test`，即"红了也照常部署"——见 CHANGELOG 追加十八）。

本地等价门禁一条命令跑完：`npm run verify`（密钥扫描 → lint → 循环依赖 → 契约漂移 → schema 漂移 → license → CHANGELOG → typecheck → 测试 → 后端契约 → 未覆盖清单）。

## 环境变量（`.env`，仅前端构建用）

| 变量 | 说明 |
|---|---|
| `VITE_CB_API_BASE` | 管理 API 端点（`https://supermarket-web.pages.dev/web`） |
| `VITE_CB_PUBLIC_API_BASE` | 公开 API 端点（`https://supermarket-web.pages.dev/pub`） |

后端 secret（`ADMIN_KEY` / 可选 `ADMIN_READONLY_KEY`）不走 `.env`，经 Dashboard secret / `.dev.vars` 注入。

## 替换收款码

覆盖 `public/wechat-pay.png` 与 `public/alipay.jpg` 后重新 build + deploy。

## 项目结构

```
functions/           # Cloudflare Pages Functions
  ├── web.js         # 管理 API：POST /web { action, adminKey, payload }
  ├── pub.js         # 公开 API：POST /pub { action, payload }
  ├── _health.js     # 探活：GET /_health
  └── lib/backend.js # 核心业务（鉴权/限流/审计/CORS/各 handler）
db/                  # D1 schema / seed / 迁移 SQL
src/
  ├── pages/         # 页面（全部懒加载 + Suspense）
  ├── components/    # UI 组件（含管理端 InlineEditForm 内联编辑）
  ├── hooks/         # useCart / useProducts
  ├── db/            # 数据访问门面（HTTP API + 缓存 + 本地兜底）
  ├── auth.ts        # 管理端调用 + 字段白名单
  ├── catalogCache.ts# 目录内存缓存（60s TTL）
  └── localStore.ts  # 本地演示模式数据层
tests/               # vitest 单测
public/
  ├── images/        # 商品图 {order}.webp + sm/ 400w 响应式小图
  ├── sw.js          # Service Worker（仅缓存静态资源，build 自动 bump 版本）
  └── manifest.json  # PWA
```

## 关键设计

- 管理端读写均走 HTTP API（`/web`），公开接口走 `/pub`；无 SDK 依赖
- 服务端重算订单金额、字段白名单、图片 scheme 白名单（纵深防御）
- 限流优先 Workers KV（跨实例），KV 异常优雅回退 D1
- 双密钥角色：`ADMIN_KEY`（全权限）+ 可选 `ADMIN_READONLY_KEY`（只读）
- 管理端商品编辑为内联编辑（InlineEditForm），禁弹窗/抽屉
- 接口契约：`docs/api-contract.json` 记录 `/web` 31 + `/pub` 8 共 39 个 action 及其属性（是否写操作 / KV 缓存键 / 限流桶），由 `npm run gen:api-contract` 从源码生成、`npm run verify:contract` 校验漂移，人读版由 `npm run docs:api` 渲染为 `docs/API.md`
- 数据库迁移：`npm run migrate status|apply|baseline`（`schema_migrations` 账目表 + checksum 防改历史），`npm run verify:schema` 拦「迁移未回写 schema.sql」（详见 `docs/adr/0005`）
- 评价晒图：压缩后 base64 入 D1（≤3 图 × ≤800KB，技术债，量大后建议迁 R2）
