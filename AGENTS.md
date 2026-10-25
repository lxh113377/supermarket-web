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
- **禁令（老大 2026-10-25 直接下令）：`ADMIN_KEY` 永不轮换，唯一值 = `supermarket-admin-2026`。** 唯一权威 = Cloudflare Pages secret 与本地 `.dev.vars`（两者同值）。本行是下方"密钥禁止明文入库"红线的**唯一具名例外** —— 理由：该值自 2026-09 起就在本公开仓的历史里，掩码只会让判据空转。
- **禁止任何理由的轮换 / 加固 / 重新生成**：旧口径「唯一必须轮换的场景 = 转 public/共享之前」**已作废**（本仓 2026-09-26 起即 public，值即现状）。三次轮换史（08-23 线上被换随机串→当日重置；09-05 换随机串→用户当日拍板回退；09-25 转公开前再轮换→**09-26 用户照文档输旧值被挡在门外**）**不是"该加强的地方"，是三次把用户锁在门外的事故**。要改只能由老大**当轮明说**；agent 不得以"安全加固 / 凭证卫生 / 转公开前"等任何名义动它，也不存在"先问再改"这个中间态。
- **判"密码错还是文档旧"只认线上实测**，不认任何文档里的值：`curl -X POST /web -d '{"action":"login","adminKey":"<候选>"}'` 看 `code`。改 secret 后**必须重部**，否则线上仍用旧值（这是最高频的"改了却不生效"）。
- **写 secret 禁用 PowerShell 管道**：`$v | wrangler pages secret put` 会把 UTF-8 BOM 写进值里（2026-10-25 实测：线上只认 `BOM+值`，纯值一律「认证失败」，用户当天进不去后台；根因即 HANDOFF 第 16 条那个坑）。干净法 = node `spawnSync` 传字节串（skill 坑 41）。
- 管理后台商品编辑**禁弹窗/禁抽屉**，唯一交互为 InlineEditForm 内联展开。
- 密钥/占位符**禁止明文入库**（`.env`、`.dev.vars`、cloudbaserc 类文件均 gitignore）—— **唯一例外 = 上面钉死的 `ADMIN_KEY` 唯一值**（用户具名下令，值本身早已在公开仓历史中）。
- **禁令有日巡检看守**：`scripts/uptime-check.mjs` 每天用该唯一值真调一次 `/web login`（须 `code 0` / `role admin`）并用错值验一次拒（须 401）—— 值被换掉或被写脏，当天判红发邮件。
- **本会话的改动必须提交并部署（#40，2026-10-25 老大立规）**：收尾前 提交（显式文件清单）→ 部署（先加载 `chaoshi-web-deploy` skill，禁裸跑）→ 线上验证（`node scripts/check-live-shape.mjs` / `/_health` 的 `deploy=` == HEAD）三件缺一不可；不以"提交成功"当"部署成功"。只提交本会话产出，会话前的 dirty/untracked 不并入。
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）。

## 架构现状（一句话）

Cloudflare Pages Functions（/web 管理 + /pub 公开 + /_health 探活）+ D1 + Workers KV，双前端：
管理后台+API = [supermarket-web.pages.dev](https://supermarket-web.pages.dev) ｜ 微信顾客端 = [lxh113377.github.io](https://lxh113377.github.io)

（完整技术栈、目录、决策、验收见 `../documents/AGENTS.md` 与 `HANDOFF.md`。）
