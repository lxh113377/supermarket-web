# 07-next-steps.part160 — 第七十三轮（续 part158：两条时态面 + 未修项 + 竞态留痕）

> 立卷原因：`verify:volume` 的 **V4「出生即贴线：新卷须 ≤3072B」** 在 pre-commit 当场拦下 part158（3432B，
> 余 664B），处置句写的是「现在就拆成两卷，别等提交前压字节」⇒ 本卷承载被拆出的后半，正文逐字未改。
> 注：V3 只判入口卷（4096B）且终态卷不判，所以 part45 那种 4081B 的老卷合法；**新卷**走的是 V4 的 3072B。

## 两条新时态面（治"拿今天的名单判昨天"）

- `.ci/contract.json` → `requiredJobSince`：新 job 对**文件名日期 < sinceUtc** 的回执免名
  （与 `requiredJobAliases` 对称、方向相反）；免名数由门面「新 job 免名 N 处」照印，不静默缩分母。
- `verdictOf({ availableJobs })` + `ciJobNamesAt(sha)`：pre-push 的必需名单**由被评提交自己的 ci.yml
  交出** —— 手抄时刻表一定漂，git 对象不会。⚠ `ciJobNamesAt` 第一版按"必须十六进制"守 ref，把
  `HEAD`（含 `H`）当场拒成 null ⇒ 通道形同不存在，是新加的夹具腿抓的。
  **给 ref 写词法守卫前先分清 sha 与 ref。**

## 下一轮 P0（写死，可证伪）

1. 推送后读回新 run：`npm run ci:status` 的「部署判定」须为该 sha 报 **已发生**，且
   `check:live-shape` L3 线上 sha == 远端 head。不成立就写"未上线"，禁写"已交付"。
2. `docs/extensions.json` 本轮按老大裁决**降级不做**：扩展点 n=1，env 面已由 `verify:env` +
   `docs/env-vars.md` 承载，另立表违反 one-fact-one-judge。要做得连着第二个扩展点一起做。
3. 10-12 到期：`docs/cron-health.json` 两条 RED 换可证伪理由（I-72-5 续账）。
4. 交接文档实测戳复核（I-72-7，已过 45 天阈值）。

## 未修（agent 无权）／并发竞态留痕

- branch protection 复跑仍 `NOT_ENFORCED`；`CF_D1_BACKUP_TOKEN` / `BACKUP_PASSPHRASE` 仍缺。
- `.ci/escape-hatch.jsonl` 被他路会话持续追加（27→30 行、始终 ` M`），C9 因此在一次链内报「未覆盖 1」
  而单跑 GREEN；`verify:restore-drill` 同轮也出现链内 FAIL／单跑 PASS。三次 `verify` 差集比对确认
  非本轮改动引入，终态 VERIFY_RC=0。**多写入方竞态只准拆槽或复算，不许调阈值求绿。**
