# AGENTS.md — supermarket-web（薄指针）

> 更新：2026-09-05（H2 清理：原 CloudBase 时代大快照已移除，收敛为薄指针，消除双处维护漂移）。
> **任何 agent 在本项目目录下工作时必须先读以下权威文档，本文件只给指针与不可丢的红线。**

## 权威文档（按优先级）

1. **项目级指令（技能绑定/部署铁律/技术栈/架构决策）** → [`../documents/AGENTS.md`](../documents/AGENTS.md)
2. **交接文档（现状事实/实测戳/事故记录/凭证）** → [`HANDOFF.md`](HANDOFF.md)
3. **部署唯一权威** → `chaoshi-web-deploy` skill（Command/清单/坑速查全量在 skill 内，禁裸跑）
4. **CI 红 / 未部署的分诊手册** → [`docs/ci-triage-runbook.md`](docs/ci-triage-runbook.md)（一条命令 `node scripts/ci-status.mjs` 自动区分"真判据红"与"账号级 0-step 秒红"；后者**禁止改代码绕**）

## 红线（不可改，永久生效）

- 部署任何 wrangler pages deploy / gh pages 推送 / d1 execute 前**必须先加载 chaoshi-web-deploy skill**，禁止凭记忆裸跑。
- `ADMIN_KEY` 固定值 = `supermarket-admin-****（掩码；真值见 .dev.vars / Pages secret）`（生产 Pages secret 与本地 `.dev.vars` 同值，禁止改回随机串）。
- 管理后台商品编辑**禁弹窗/禁抽屉**，唯一交互为 InlineEditForm 内联展开。
- 密钥/占位符**禁止明文入库**（`.env`、`.dev.vars`、cloudbaserc 类文件均 gitignore）。
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）。

## 架构现状（一句话）

Cloudflare Pages Functions（/web 管理 + /pub 公开 + /_health 探活）+ D1 + Workers KV，双前端：
管理后台+API = [supermarket-web.pages.dev](https://supermarket-web.pages.dev) ｜ 微信顾客端 = [lxh113377.github.io](https://lxh113377.github.io)

（完整技术栈、目录、决策、验收见 `../documents/AGENTS.md` 与 `HANDOFF.md`。）