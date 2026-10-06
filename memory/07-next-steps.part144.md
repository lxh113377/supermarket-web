# 07-next-steps · 第六十九轮 · 本轮自己踩的坑

## 本轮自己踩的三个坑（都属同一族，已进 CHANGELOG）

- **A/B 探针第一版按契约字段名造 fixture**：写 `createdAt`/`artifactCount`，而 `check-backup-liveness.mjs:263`
  读的是 GitHub API 原始名 `created_at`/`artifacts_count` ⇒ 全程 `undefined`，
  判据把"取数面坏"报成了"调度层不成立"。**取数面自己坏了，红因却是套娃的。**
- **变异件写到 `%TEMP%`** ⇒ `import './lib/preflight.mjs'` 断链，变异腿测的是"文件不存在"而不是"判据变红"。
  变异件必须落在仓内 `scripts/` 下，测完删。
- **`git add -A` 收了备份残留** ⇒ 已 gitignore（见上）。
- 共性：**每次自己取的数，先证输入非空再让它进结论**。

## 下一轮 P0（写死在此）

- **远端回执**：本轮推送后 CI 是否真绿、`/_health` 的 `deploy` 是否真换成新 SHA ——
  **未实测前不许写"已上线"**（`check:delivery-claims` 就是为这条立的尺）。
- **下一夜 cron 回执**：run `37428097178` 里 `check:cron-health` 那一步是 `skipped`；
  修法上线后它必须变成 `ran`，而**只有下一次 scheduled run 的 step 明细能证明**。
- **`docs/cron-health.json` 两条 RED 硬到期 2026-10-12**（剩 6 天）：在册理由「缺 `CF_D1_BACKUP_TOKEN`」**不完整** ——
  成环那一半第六十八轮已修（第九轮实测 presence rc=0 坐实），剩余那一半仍是用户侧凭据。
  到期轮必须按新根因换一条**可证伪**的理由，不许续写旧理由。
- **10-07 性能第二批**（cadence 7 天）：本轮 `report:live-perf` 实测 `verdict=RED`，最新完整批次 `2026-09-30`、
  距今 6 天；customer 侧 `d2`/`d3`/`t1041` 三批 **7 份全部 `NO_FCP` + 最终 URL `about:blank`**（网络类，没采到，
  **不得折进基线**）。到点采一批新的再谈立线。
- **`check:delivery-claims` 升档判断**（第六十八轮立、顺延到本轮未做）：真实面读数 `matched=1 mismatched=15`、
  测量句缺尺 16 条。定性完再谈升阻断位 —— 误报率没归零前接 pre-commit 会逼人改用绕法。
