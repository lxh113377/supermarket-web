# 03 - 技术栈

> 本文件记录项目使用的技术栈。sync 命令会自动更新此文件。
> 归档类型：快照（整体复制到归档）

<!-- SYNC_AUTO_GENERATED_START -->
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
<!-- SYNC_AUTO_GENERATED_END -->

## 构建与部署
<!-- 手动补充：构建工具、部署方式、CI/CD -->
- 构建：**Vite 8**（`npx vite build`，项目铁律用 npx 直调，不用 `npm run build`）；构建期注入 `sw.js` 的新 `CACHE_VERSION`（判断是否重新部署的唯一可靠指纹）
- 部署：**双端** ① Cloudflare Pages（`npx wrangler pages deploy dist --project-name supermarket-web`，必须有 `functions/` + `wrangler.toml`，缺则纯静态 POST 全 405 —— 坑#30）② GitHub Pages（`lxh113377.github.io`，push main → `dispatch.yml` 触发重建）。流程一律走 `chaoshi-web-deploy` skill
- CI/CD：`ci.yml`（六步门禁 + 部署 + 线上冒烟 + 失败自动回滚）、`dispatch.yml`、`uptime.yml`（每日探活）
- 本地门禁：`npm run verify`（密钥扫描 → oxlint → 循环依赖 → tsc×2 → vitest → 后端契约 → 未覆盖清单）

## 运行时要求
<!-- 手动补充：运行时版本要求 -->
- Node **22**（CI setup-node 指定）；npm registry = npmmirror
- 前端：React 19.2 / react-router-dom 7.18（HashRouter）/ echarts 5.6 / Tailwind 3.4 / TypeScript 7（strict）
- 工具链：Vitest 5 + jsdom、oxlint 1.71、wrangler 4.124
- 后端运行时：Cloudflare Pages Functions + D1（绑定 `DB`）+ Workers KV（绑定 `RATE_KV`）
- 浏览器目标 `es2020`；PWA 需手动引导安装（微信/iOS 无 `beforeinstallprompt`）
- 质量基线（2026-09-23 实测）：vitest 27 文件 / 168 用例，后端契约 54 断言，oxlint 0 warning，70 模块 0 循环依赖

> ⚠️ 上方 SYNC_AUTO 区仍写着 Cloudbase（云开发）旧依赖，那是自动生成块的过期快照，不代表当前架构；当前架构为 Cloudflare Pages + D1 + KV。
