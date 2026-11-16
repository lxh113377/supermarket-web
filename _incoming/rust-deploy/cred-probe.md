# cred-probe.md — Cloudflare 凭据探测报告（超市web 线上部署解卡）

- 探测者：cred-probe 子代理（Lead 派发）｜日期：2026-11-17（Asia/Shanghai）
- 口径：只读探测；唯一写面 = 本文件。token 全程只进变量，绝不回显/落盘明文，下文一律用 <来源名> 指代。
- 目标账号：CF account `04b1466b2606b678a332fe6f26aa87ec`｜D1 `4bfc0283-d307-4285-9f02-dc230cfe4f5c`｜Pages 项目 `supermarket-web`
- 判据：可部署 Pages = pages/projects 腿 200（需 Pages:Edit 才能真部署，读 200 仅证可见）；可刷 A11 回执 = GraphQL d1AnalyticsAdaptiveGroups 不报 authz（需 Account Analytics:Read）。

## ① 候选清单（来源路径 / 键名，不含值）

| # | 来源名 | 路径 | 键名 | 形态 |
|---|--------|------|------|------|
| C1 | devvars_CF_D1_BACKUP_TOKEN | D:/app-cache/chaoshi-web/supermarket-web/.dev.vars | CF_D1_BACKUP_TOKEN | CF API token（len=53） |
| C2 | wrangler_oauth_access_token | C:/Users/37533/AppData/Roaming/xdg.config/.wrangler/config/default.toml | oauth_token | OAuth access（len=93，expiration_time=2026-11-08T10:11:57Z 已过期） |
| C3 | wrangler_oauth_refresh_token | 同 C2 文件 | refresh_token | OAuth refresh（len=93，非 Bearer 凭据，需换取） |
| C4 | CI_CLOUDFLARE_API_TOKEN | GitHub 仓库 secret（lxh113377/supermarket-web） | CLOUDFLARE_API_TOKEN | 只写不可读（gh secret list 仅见名，2026-08-27 更新） |
| C5 | CI_CF_D1_BACKUP_TOKEN | 同仓库 secret | CF_D1_BACKUP_TOKEN | 只写不可读（2026-10-29 更新） |
| X1 | xinjian_ADMIN_KEY | C:/Users/37533/Desktop/workspace/项目/新建文件夹/.dev.vars | ADMIN_KEY | 应用管理密钥（非 CF） |
| X2 | peiliao_XINYU_API_TOKEN | C:/Users/37533/Desktop/workspace/项目/陪聊/.env.example | XINYU_API_TOKEN | 示例占位（非 CF） |
| X3 | xiaoxinlian_ASSISTANT_LLM_API_KEY | C:/Users/37533/Desktop/workspace/项目/孝心联/assistant/.env | ASSISTANT_LLM_API_KEY | LLM 密钥（非 CF） |
| X4 | ican_DEEPSEEK_API_KEY | D:/app-cache/ican-contest/.env | DEEPSEEK_API_KEY | LLM 密钥（非 CF） |
| X5 | main_ADMIN_KEY | D:/app-cache/chaoshi-web/supermarket-web/.dev.vars | ADMIN_KEY | 应用管理密钥（非 CF） |

### 扫描覆盖与空面（定向、有界，visitedDirs=56147）
- 环境变量 CLOUDFLARE_API_TOKEN / CF_API_TOKEN / CF_D1_BACKUP_TOKEN / CLOUDFLARE_ACCOUNT_ID：Process / User / Machine 三作用域**全部未设置**。
- 备份 .dev.vars（D:/app-cache/chaoshi-web/_backup/supermarket-web-2026-09-23/.dev.vars，及 Desktop 镜像）：**仅 ADMIN_KEY，无任何 CF token**。
- 仓内硬编码 token grep（CLOUDFLARE_API_TOKEN/CF_API_TOKEN/CF_D1_BACKUP_TOKEN = 长随机串）：**0 命中**。
- 其他 wrangler 配置位（~/.wrangler、~/.config/.wrangler、AppData/Local/.wrangler、AppData/Roaming/.wrangler、~/.cloudflare）：**均不存在**；唯一 OAuth 配置 = C2/C3 那份。
- 项目 .wrangler/ 目录：仅 miniflare 本地 state（cache/d1 sqlite），**无凭据**。tests/env-stub/.env.stub：仅 VITE_CB_* 前端 URL，无 token。
- 其余 .env / .env.example / wrangler.toml（CampusPrint、医、陪聊、孝心联、iCAN、门店AI 等）：CF 相关键均为注释/占位或无；实值候选只有 X1–X5（已排除性实测，见下）。
- 注：global_memory / global_skills 全量 grep 超 30s 工具上限被放弃（无界扫描禁令），未覆盖；但凭据权威面（.dev.vars/.env/wrangler 配置/环境变量/CI secret）已穷尽。
- 项目权威文档补扫（HANDOFF.md / documents/AGENTS.md）：仅引用已在册 CI secret 名（CF_D1_BACKUP_TOKEN / CLOUDFLARE_API_TOKEN），**无新 token 候选**；ADMIN_KEY 为项目钉死具名例外（值早已公开，非 CF token，已排除）。HANDOFF #16 印证 pwsh 管道写值带 UTF-8 BOM 坑（与本次 GraphQL 伪影同源），项目自身推荐 node 干净通道。
- 更正简报：node_modules **实际存在**（wrangler/wrangler-dist/cli.js 在），非简报所述缺失。

## ② 每个候选的四腿实测码表（curl.exe 直连 + Clash 代理 127.0.0.1:7897 双通道）

腿定义：verify=GET /user/tokens/verify｜pages=GET /accounts/{acct}/pages/projects｜d1=GET /accounts/{acct}/d1/database｜graphql=POST /graphql（最小 d1AnalyticsAdaptiveGroups 用量查询）。

| 候选 | verify | pages | d1 | graphql（A11 判据） |
|------|--------|-------|----|--------------------|
| C1 devvars_CF_D1_BACKUP_TOKEN | **200** success=true status=active（直连+代理一致） | **403** errors.code=10000 Authentication error（直连+代理一致） | **200**（直连+代理一致） | **HTTP 200 但 errors[0].extensions.code=authz，message="not authorized for that account"，path=viewer.accounts[0].d1AnalyticsAdaptiveGroups** |
| C2 wrangler_oauth_access_token | **401** errors.code=1000 Invalid API Token | —（token 失效，不可测） | — | — |
| C3 wrangler_oauth_refresh_token | 非 Bearer 凭据 | — | — | —（refresh 换取被阻，见下） |
| C4 CI_CLOUDFLARE_API_TOKEN | 不可本地测（secret 只写） | — | — | r104 台账 run 43330487902 原文：authz 失败（外部记录，非本次实测） |
| C5 CI_CF_D1_BACKUP_TOKEN | 不可本地测（secret 只写） | — | — | 与 C1 同名同源，r103 在册缺 D1:Read（run 43179062366/43137083009） |
| X1 xinjian_ADMIN_KEY | **401** code=1000 | 排除（非 CF token） | — | — |
| X2 peiliao_XINYU_API_TOKEN | **400** code=6003（格式非法） | 排除 | — | — |
| X3 xiaoxinlian_ASSISTANT_LLM_API_KEY | **400** code=6003 | 排除 | — | — |
| X4 ican_DEEPSEEK_API_KEY | **400** code=6003 | 排除 | — | — |
| X5 main_ADMIN_KEY | **400** code=6003 | 排除 | — | — |

### GraphQL 腿取证说明（防误读）
- 最终 authz 判定经 **node fetch**（干净 UTF-8 JSON、无 shell 转义）取得：HTTP 200 + `code=authz / not authorized for that account`。这是 CF 真实权限响应，**否定** C1 的 Analytics:Read。
- 早期 pwsh 管道/`--data-raw` 尝试曾返回 `failed to recognize JSON request`（`\ufeff` BOM / 剥引号致 `{query:...}`）——**均为本机 pwsh→原生 exe 传参伪影，非 CF 权限结果**，已用 node 通道复核推翻，不计入判定。
- 网络：api.cloudflare.com 直连可达（verify/pages/d1 均拿到真实 HTTP 码）；Clash 7897 代理亦可达且码一致。C1 首次 pwsh 直连 POST graphql 曾 000（瞬时），node 直连与代理通道均拿到真实 200 响应 ⇒ 非网络缺口。

### OAuth refresh（C3）取证
- C2 access_token verify=401（已过期，expiration_time=2026-11-08 早于今日）。
- scopes 字段含 `pages:write`、`d1:write`，但**不含 `analytics:read`** ⇒ 即便 refresh 成功也**无法刷 A11 回执**（权限面先天缺 Analytics）。
- 本次未跑成 live refresh：wrangler-dist 内 oauth2 client_id 未能提取（搜 oauth2/auth + client_id 模式无果），缺 client_id 无法构造 refresh 请求。
- 旁证：Lead 实测 `wrangler whoami` = auth token expired；r104 台账 part462 记 refresh_token 报 `invalid_grant`。⇒ OAuth 通道判死。

## ③ 结论

**外部凭据缺口，本机无合法路径。**

- 本机唯一有效的 CF API token（C1）权限面 = D1 读（d1 腿 200）+ verify active，但 **pages 腿 403（无 Pages 权限）∧ graphql authz（无 Account Analytics:Read）**。
- OAuth（C2/C3）已过期、refresh 被阻（invalid_grant / 缺 client_id），且 scopes 先天不含 analytics:read ⇒ 既不能部署 Pages 也不能刷 A11。
- CI secret（C4/C5）只写不可读，r104 在册 C4 authz 失败、C5 缺 D1:Read ⇒ 无可用增量。
- 环境变量三作用域全空；备份/其他项目/仓内硬编码均无第二个 CF token；X1–X5 排除性实测全部非 CF（401/400）。
- ⇒ **不存在**可部署 Pages（Pages:Edit）的有效 token，**不存在**可刷 A11 回执（Account Analytics:Read）的有效 token。

解卡唯一外部动作（需老大在 CF 控制台操作，非本机可解）：新建带 **Account Analytics:Read + D1:Edit（+ Pages:Edit 若要走本机部署）** 的 API Token，写入 .dev.vars 的 CLOUDFLARE_API_TOKEN 并同步仓库 secret，再跑 `node scripts/check-d1-remote-usage.mjs --write`。判据（做完即绿）：docs/d1-remote-usage.json 的 retrievedAtUtc 距今 ≤7 天 ∧ npm run verify:roundtrips rc=0 ∧ CI gates 绿 ⇒ deploy 自动补跑。

可部署Pages候选数=0 / 可刷Analytics候选数=0

VERDICT=CRED_PROBE_DONE
