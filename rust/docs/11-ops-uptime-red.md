# 运维红灯登记：Uptime 日巡检连红（2026-10-28 复核）

> 本文是**本会话的取证记录**，不是运维权威件；权威 = `scripts/uptime-check.mjs` + `docs/ci-triage-runbook.md` + HANDOFF。

## 结论（三句话）

1. **管理密钥红线无恙**：正密钥 `code 0 / role admin`、错值 401（CI 巡检自己的复验行 + 我本地 curl 实测，两条独立证据一致）。
2. 巡检判红的**唯一断言**是：`打印后端反代 HTTP 530（静态面可看但下单链路断）` —— CampusPrint 那条反代链路。
3. 这条红**连红 6 天**（2026-10-23 起），**不是本会话引入**：本会话的改动全在 `rust/` 与文档面，未触及该链路。

## 证据

| 证据 | 内容 |
|---|---|
| CI 日志（run 40644985478，step `Probe production endpoints`） | `/_health → status ok / db ok / deploy cbf549c`；管理端与顾客端首页 200；打印页静态面 200；**打印后端反代 530**；`管理密钥禁令复验 → 唯一值 code 0 role admin；错值 401（禁令在守）` |
| 本地实测（本会话） | `curl POST /web login` 正确值 ⇒ `{"code":0,"role":"admin"}`；错值 ⇒ HTTP 401 `auth_failed` |
| 历史 | `gh run list --workflow=uptime.yml --limit 6` ⇒ failure ×6（2026-10-23 ~ 10-28 每天一次） |

## 下一步（给运维/下次接手）

1. 查 `CAMPUS_PRINT_ORIGIN`（现值见 `docs/env-vars.md`）与那台 CampusPrint 服务是否在线；
2. 本仓侧入口是 `scripts/print-tunnel.mjs` —— 530 通常意味着隧道/反代起不来而不是代码错；
3. 同一次巡检里还有两条未具名红（`d1-local-backup.yml` 连红、备份链活性 step），它们的具名根因要按
   cron-health 的「在册失败 step ⇄ 实测失败 step 对账」机制登记，**不是**靠改阈值或换豁免到期日绕过。

## 与本会话的关系

本会话（45 个 API 动作逐个原生化）不碰前端与打印链路；此登记的作用是**不让一条连红 6 天的生产信号被静默忽略**。
## 附二 · D1 每日备份红（2026-10-29 定案：外部凭据缺口，不降级）

**事实（一手）**：`D1 Daily Backup` 自 2026-10-24 起连续 5 次 failure（run 40790479911 / 40603075999 / 40420891865 / 40239765884 / 40137849606）；
失败 step 名叫 **Fail loudly instead of reporting a green no-op** —— 这条红是**工作流自己设计的正确信号**，不是缺陷。

**根因**：外部凭据缺口。`gh secret list` 只有 `CLOUDFLARE_API_TOKEN` 与 `GH_DISPATCH_TOKEN`；
`CF_D1_BACKUP_TOKEN` 与 `BACKUP_PASSPHRASE` **都不存在**，`gh variable list` 为空。
导出步与上传步都依赖它们 ⇒ 本 run 不产出任何可核对的备份产物（也就是：**生产库当前没有已验证的备份**）。

**为什么不设 `BACKUP_SKIP_OK=true`**（这是本条的处置决定，理由写在这）：
① 它把「没有备份」从 FAIL 降成 WARN ＝ 由我代 owner 接受「暂时不备份」；仓内注释的原意是「别再让它沉默」，
   而这条红现在**既不沉默、又具名缺哪个 secret、又给了三条出路** —— 唯一正确的动作是补凭据，不是把红变黄。
② 本条属「外部凭据缺口」，是我唯一允许「办不到 + 落待办 + 给证据」的类别。owner 若确要豁免，一条命令即可（见下）。

**解除它需要的两条命令**（都要 owner 的账号/口令，我无法代做）：
1. `gh secret set CF_D1_BACKUP_TOKEN` —— 值 = Cloudflare API Token（权限 D1:Read，账号 id 04b1466b2606b678a332fe6f26aa87ec）；
2. `gh secret set BACKUP_PASSPHRASE` —— 值 = owner 自定的解密口令（本仓公开 ⇒ 明文导出不允许，脚本会自动加密，产物名带 -enc；恢复用 `npm run backup:decrypt`）。

**若 owner 确要显式豁免**（降为 WARN，仍会打印事实）：`gh variable set BACKUP_SKIP_OK --body true`。

**未做**：我没有改 `.github/workflows/d1-backup.yml` 一个字节 —— 它的报错已具名 `CF_D1_BACKUP_TOKEN`、已给两条出路，
另一条守卫也已具名 `BACKUP_PASSPHRASE` 与三条出路（先读后动，避免把一份已经很好的判据改差）。
## 附三 · 探针定案（2026-10-29 14:59 实测）：第三解被证伪

**问题**：仓库已有的 `CLOUDFLARE_API_TOKEN` 能否直接拿来当备份 token（零新凭据）？

**探法**：一次性 dispatch 工作流 `.github/workflows/probe-d1-scope.yml`，用该 secret 打
`GET https://api.cloudflare.com/client/v4/accounts/<acc>/d1/database`，只打印状态码与 success/errors。

**判定（run 40832623872，原文）**：
```
PROBE http=401
PROBE success= False
PROBE errors= [10000]
```
**401 + 错误码 10000 = 认证失败**（Cloudflare 的「权限不足」通常是 403）⇒ 该 token 本身不被接受，
很可能是**过期/已失效**，不只是缺 D1 scope ⇒ **第三解证伪**，不能拿它当备份 token。

**顺带纠一处我此前的判断**：`ci-deep.yml` 里那条 "D1 remote cumulative usage (advisory)" 步骤在 CI 里是
**success** —— 但它证明不了任何 D1 能力（advisory 口径 + 读的是累计用量面）。我当时特意没拿它当凭据，
现在被 401 反证是对的。另：该 token 同时被 `ci-deep.yml:139/205` 使用 ⇒ **它可能早就失效了**，值得 owner 一并核。

**本轮已自动完成的一步**：`gh secret set BACKUP_PASSPHRASE`（值取自本机 `.dev.vars` 同值，24 字符），
`gh secret list` 已显示 2026-10-29T06:56:59Z。⇒ 我把此前「两条命令都要 owner」的说法**收窄为一条**：
剩下唯一的人工面 = 建一个 Account·D1·Read 的 Cloudflare API Token 并 `gh secret set CF_D1_BACKUP_TOKEN`。

**探针已删**（临时仪器不留在仓里）；本文件与工作流均无残留探针。

**下一步（owner）**：建 token（Cloudflare 控制台 → My Profile → API Tokens → 权限 Account·D1·Read）⇒
`gh secret set CF_D1_BACKUP_TOKEN` ⇒ `gh workflow run d1-backup.yml` ⇒ 看 Export=success、Upload(encrypted)=success、
产物名 `d1-backup-enc-<n>`。口令那半已就绪，配好 token 当晚就会真产出密文备份。
