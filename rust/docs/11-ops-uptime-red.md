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
