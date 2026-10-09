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

## ②-B/②-C 续账（同轮稍后：恢复通道已上线并两侧兑现）

- 通道**该放行的放行**（基线 cancelled ⇒ `RECOVER ... 近 20 笔第 1 次用通道，上限 2`，推送通过）、
  **该拦的拦住**（基线 failure ⇒ 打印"那是 CI 下过判决的红，本通道不认"并拒推）⇒ 放宽没变成后门。
- 真判据红那一段经老大授权走 `CI_GREEN_SKIP=1`。**我在这里制造了一条假证据**：重试循环 grep 判据与
  break 条件没对齐 ⇒ 同一笔推两次、`.ci/escape-hatch.jsonl` 落两行相同绕过记录，第二行是
  `base==head` 的 no-op，不构成绕过却被计量（两行 utc 相隔 9 秒）。**未删行**（删共享台账会毁掉
  他路会话 3 行在途记录，且"抹掉计量"是本仓最反对的动作）。
- **下一轮 P0（新增，写死可证伪）**：`scripts/ci-green-contract.mjs` 在
  `local_sha == remote_sha`（无可推之物）时**不得写绕过行**；重试循环必须以
  `git ls-remote` 复算决定是否再推，禁止用 grep 自己的 stdout 当成功判据。
- 终态一手：`run 37870711072@4fdb4c9` CI `completed/success`，六 job 逐个 success
  （含 `e2e-cloud-stub=success(12 步)` —— 上轮那个 0 步 1s cancelled 的 job）、
  `deploy=success(9 步)`；`check:live-shape` **3/3 PASS、漂移 0**，线上 `4fdb4c9` == HEAD。
  ⇒ 四项改造**已上线**，且"已上线"由判据自己说出（`ci:status` 的「部署判定：已发生」）。
