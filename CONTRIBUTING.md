# 贡献指南

感谢你愿意参与。本项目当前为**单人/小团队维护**，为保证改动质量，请按以下流程提交。

## 1. 环境准备

```bash
cd supermarket-web
npm install
cp .env.example .env     # 前端端点；后端密钥写 .dev.vars（勿提交）
npm run dev              # http://localhost:5173
```

无 `.env` 时自动降级为本地演示模式（数据存 localStorage），不影响开发。

## 2. 提交前必须通过本地门禁

```bash
npm run verify
```

该命令串起 7 道检查：密钥扫描 → oxlint → 循环依赖 → typecheck（双配置）→ vitest（168 用例）→ 后端契约（54 断言）→ 未覆盖清单。
**任何一项红，不要提交。** `git commit` 时 pre-commit 还会再扫一次暂存区密钥。

常用单项命令：`npm run lint` / `npm test` / `npm run typecheck` / `npm run check:cycles`。

## 3. 提交规范

- 使用 Conventional Commits：`feat:` `fix:` `perf:` `docs:` `chore:` `refactor:` `test:`
- 一个提交只做一件事，标题用中文描述清楚"改了什么"
- **禁止** `git add -A` 提交他人/其他会话的未提交改动（并行会话常驻场景，按路径精确 add）

## 4. 分支与 PR

- 从 `main` 切分支，命名 `feat/xxx` `fix/xxx` `perf/xxx`
- PR 需填写模板（`.github/PULL_REQUEST_TEMPLATE.md`），说明改动、验证方式、风险面
- CI（`.github/workflows/ci.yml`）必须全绿；push main 会自动部署 Cloudflare Pages，部署后跑线上冒烟，**冒烟失败会自动回滚上一生产部署**

## 5. 本项目不可违反的约束

| 约束 | 原因 |
|---|---|
| 管理端商品编辑保持**内联编辑**，禁弹窗/抽屉/底部面板 | 已定的交互范式 |
| 不删/不放宽 CSP（`index.html`） | 安全基线 |
| 后端密钥不入库、不写入代码或 `.env` | 走 Pages secret / `.dev.vars` |
| 不破坏「23 个 action + 业务语义」的既有行为 | 前端与后端契约共用 |
| 商品图路径沿用 `/images/{order}.webp` 硬约定 | 双端与 SW 缓存依赖 |
| 顾客端唯一入口为 `https://lxh113377.github.io`（微信侧） | 已对外发布 |

## 6. 测试要求

- 新逻辑必须有单测；改后端 action 必须补 `scripts/verify-backend.mjs` 契约断言
- 新增/删除后端 action，或改动缓存键、限流策略后，跑 `npm run gen:api-contract` 重新生成 `docs/api-contract.json` 再提交（`npm run verify` 会校验源码与契约是否漂移）
- 端到端冒烟：`npx playwright install chromium` 一次后，`npm run test:e2e`（自动起 dev server，跑演示模式数据）；改了页面结构/文案导致用例失败时，请同步更新 `tests/e2e/`
- 产物体积：`npx vite build` 后 `npm run check:size`；确有必要超预算时更新脚本内 `BUDGET` 并说明原因
- 页面级改动请在本地双视口（375 / 1280）目检一次
- 涉及缓存/图片等资源类改动，验收请用**无头浏览器截图**确认（curl 比字节测不到 SW 与 SPA 渲染链路）

## 7. 行为准则

请保持友好、就事论事。安全问题请走 `SECURITY.md`，不要开公开 Issue。
