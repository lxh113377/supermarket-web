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
- `ADMIN_KEY` 的**唯一权威 = Cloudflare Pages secret 与本地 `.dev.vars`（两者同值）**；文档/skill/记忆一律不写明文。
- **后台密钥强度是用户拍板的取舍，不是待修缺陷**：现值为便于手机输入的短语型密钥，**其明文曾出现在公开仓 git 历史里**（历史 blob 抹不掉）。用户 2026-09-26 明确选择承受该风险以换日常登录便利 ⇒ **禁止 agent 擅自"加固"成随机串**。本仓因"轮换 → 文档没同步 / 改 secret 没重部"反复报过登录失败：2026-08-23 实测三处密钥值互不相同（线上随机串 / 文档旧值 / `.dev.vars` 第三个值）致「认证失败」，当日重置、08-24 复核；2026-09-05 轮换为随机串后用户因"影响日常登录"拍板回退；2026-09-25 转 public 前再轮换，**2026-09-26 用户照文档输旧值又被挡在门外**。要改强度先问。
- **唯一必须轮换的场景**：把本仓**转 public / 共享**之前——先轮换 + **重新部署一次**让旧值真正作废（Pages secret 是部署时注入，不重部不生效），再翻可见性。反向操作（转回 private）无此前置。
- **判"密码错还是文档旧"只认线上实测**，不认任何文档里的值：`curl -X POST /web -d '{"action":"login","adminKey":"<候选>"}'` 看 `code`。改 secret 后**必须重部**，否则线上仍用旧值（这是最高频的"改了却不生效"）。
- 管理后台商品编辑**禁弹窗/禁抽屉**，唯一交互为 InlineEditForm 内联展开。
- 密钥/占位符**禁止明文入库**（`.env`、`.dev.vars`、cloudbaserc 类文件均 gitignore）。
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）。

## 架构现状（一句话）

Cloudflare Pages Functions（/web 管理 + /pub 公开 + /_health 探活）+ D1 + Workers KV，双前端：
管理后台+API = [supermarket-web.pages.dev](https://supermarket-web.pages.dev) ｜ 微信顾客端 = [lxh113377.github.io](https://lxh113377.github.io)

（完整技术栈、目录、决策、验收见 `../documents/AGENTS.md` 与 `HANDOFF.md`。）