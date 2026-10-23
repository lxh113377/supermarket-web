# 07-next-steps.part170 — 第七十八轮（高优先两项：部署口径/载体龄期）

> 建卷理由：主卷只留指针级摘要；四项改造细节按「高两项/中两项」拆 170/171 两卷，
> 保证**出生即留 ≥25% 余量**（本卷立 V4 口径的那一轮不许自己违例——写 170 初稿 4040B 触 V4 红，当场拆卷，非事后压措辞）。

## 改造一（高）部署面口径收口
- `chaoshi-web-deploy` 3.9.5→**3.9.7**：坑表新增 **坑 40**（Git Data API 增量推送必须取 git 索引版字节
  + 上传后当场校验 `blob sha === git hash-object`，复跑件 `scripts/check-head-closure.mjs`），§5.2 头部加取字节口径交叉引用。
- 幽灵脚本收口：`scripts/ghpages-push.mjs` 实测已被内层 `2aaa830` 删除；§5.2 脚本块/§5.5 核心结论/前提 4/Step 1
  四处执行性引用全部改口径（主通道 `git push origin main`，本轮实测 `ls-remote` 与 `push --dry-run` 均 rc=0，
  Clash 127.0.0.1:7897 在、gh 全作用域登录）。坑 16/21/25 属历史事故记录保留原文并靠坑 40 索引，不删。

## 改造二（高）对标载体防"转引病生成器"
- 实测动因：`report:peers` 裸跑打印新表但台账停在 10-18（6 天），下轮把旧表当新量。
- `benchmark-peers.mjs`：新增导出纯函数 `resolveLedgerPath`/`ledgerAgeDays` + `LEDGER_DEFAULT`；
  裸跑不落盘但打印"现行台账 measuredAt=…（N 天前，超窗警示）"；`--json [path]` 缺参落默认台账；
  `--offline`/裸跑/`--no-json` 一律不落盘（judge-side-effects 快照默认跑零触网零写面，实测盲面 7/7 不扰）；
  `--no-json` = 演练面（零触网、连龄期也不印）。selftest 8→**9/9**。
- `package.json`：`report:peers` ⇒ `node scripts/benchmark-peers.mjs --json docs/benchmark-peers.last.json`。
- 台账实测刷新：measuredAt=2026-10-23T17:47Z，10 仓、7 全面可得；erpnext 30 天 3527 commits、medusa 234、
  本项目 362；**mall/litemall/grocy 近 30 天默认分支 0 提交、jgudo 2024-07 停更**（"标杆=活着"名册内 4/9 不成立）。
- `cli-entrypoints.md` 登记行同步 + `doc-commands --update` 重生（363 提及 0 不成立）。

