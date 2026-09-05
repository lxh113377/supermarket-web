# AGENTS.md — supermarket-web 项目 skill 绑定表（P-1）

> 2026-09-05 由优化审查会话补齐（此前缺失，A-memory-start Step 3.5 P-1 告警源）。
> 新会话检测到本项目时按此表加载 skill / 执行门禁；结构与焚诀 A-project-handoff 约定对齐。

## 门禁命令

```
门禁命令: cd supermarket-web && npm run verify:backend && npm test
```

- 触发条件：任何修改类任务（改 `functions/`、`src/`、`scripts/verify-backend.mjs`、`db/`）完成后必须跑，全绿才可交付。
- 改动后端行为时另跑 `node scripts/scan-secrets.mjs --staged`（提交前）。
- 本地构建用 `npx vite build --outDir <fresh-dir> --emptyOutDir`（沙箱删除层故障期禁 `rm -rf dist`，见 lessons-system-maintenance 2026-09-05 两条）。

## 项目绑定 skill

| skill | 场景 |
|---|---|
| A-memory-start | 每轮开场（全局铁律） |
| A-get-memory | 任务收尾反哺（本项目的坑已沉淀 2 条到 lessons-system-maintenance） |
| A-project-handoff | 项目续接/交接摘要 |
| senior-developer（专家） | 代码类任务的默认角色 |

## 关键事实速查（细节以磁盘实测为准，禁止凭旧快照下结论）

- **架构**：Vite 8 + React 19 + TS + Cloudflare Pages Functions + D1；前端双部署（pages.dev 管理端 / github.io 顾客端，dispatch 双发）。
- **后端分层**（2026-09-05 拆分）：`functions/lib/{db,security}.js` + `functions/lib/actions/{products,orders,reviews,submissions,ai}.js`，`backend.js` 仅剩调度 + 兼容 re-export（测试契约：`checkRate/checkRateKV/resolveCorsHeaders/batchUpdateProducts/batchDeleteProducts` 必须从 backend.js 可导入）。
- **action 契约 23 个**：改动必须同步 `src/auth.ts` 调用侧 + `scripts/verify-backend.mjs`（47 断言，计数类断言用相对基线禁硬编码）。
- **wrangler.toml 必含 `pages_build_output_dir = "dist"`**，否则整个 toml 被忽略 → D1 绑定静默失效（lessons.part35）。
- **改 Pages secret 后必须重新部署才生效**（部署时注入）；本地密钥在 `.dev.vars`（gitignore）。
- **商品图**：`public/images/<order>.webp`（800w）+ `public/images/sm/<order>.webp`（400w 缩略图）；新增商品图必须同步生成 sm/ 副本，否则 srcSet 静默回退原图。
- **echarts**：只允许 `echarts/lib/*` 深路径按需注册（barrel 会整包拖入，实测 gz 452→331K 靠此）；pie 空态用 DashboardTab HTML overlay，勿加回 GraphicComponent。
- **提交纪律**：并行会话风险——`git add` 只用显式文件列表；提交前 `git status` 确认无他人改动混入；编辑后构建/断言前先 grep 验证落盘（写入竞态坑）。
- **git 操作防静默失败**（2026-09-05 实测坑）：① git 命令**禁用 `| tail`/`| head` 等管道吃 exit code**——失败会静默进 `&&` 链继续执行后续命令；② 新建分支/新 ref 操作后必须 `git branch --show-current && git rev-parse --verify HEAD` 自检 ref 落盘——沙箱 shim 在 npm install 等大 IO 期间可致 ref 写入失败（HEAD 挂 unborn 分支 → commit 变成根提交、父链断裂）；③ 修复法：`git symbolic-ref HEAD refs/heads/main` 指回 main 后直接 commit（index 中 staged 改动完好）；④ 重大升级评估优先 stash + main 直操，少用临时分支。
