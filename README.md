# 超柿 Web（supermarket-web）

面向宿舍/小区场景的在线超市购物系统。顾客端浏览商品、加购下单、扫码支付；管理后台管理商品、订单、评价与服务表单。

![CI](https://github.com/lxh113377/supermarket-web/actions/workflows/ci.yml/badge.svg)
![tests](https://img.shields.io/badge/tests-168%20passed-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

**文档**：[贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [更新日志](CHANGELOG.md)

## 功能一览

| 端 | 功能 |
|---|---|
| 顾客端 | 首页 / 分类 / 商城 / 商品详情 / 购物车 / 确认订单 / 支付页 / 下单成功 / 服务表单 / AI 导购 |
| 管理后台 | 数据看板（echarts）/ 商品管理（内联编辑）/ 订单管理 / 评价管理 / 服务表单处理 |
| 后端 | `/web` 管理 29 action、`/pub` 公开 7 action、`/_health` 探活；D1 + KV；限流 / 审计 / 双密钥角色 |
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

`.github/workflows/ci.yml` 单 job 六步：secret 扫描 → oxlint → vitest（**168 用例 / 27 文件**）→ typecheck（前后端双配置）→ build（注入线上端点）→ 后端契约验证（`node scripts/verify-backend.mjs`，54 断言）。

push main 后 `deploy` job：部署 Cloudflare Pages → 线上冒烟（`_health` + 公开接口契约）→ **冒烟失败自动回滚上一生产部署**。另有 `dispatch.yml`（github.io 顾客端双发）与 `uptime.yml`（每日探活）。

本地等价门禁一条命令跑完：`npm run verify`（密钥扫描 → lint → 循环依赖 → typecheck → 测试 → 后端契约 → 未覆盖清单）。

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
- 评价晒图：压缩后 base64 入 D1（≤3 图 × ≤800KB，技术债，量大后建议迁 R2）
