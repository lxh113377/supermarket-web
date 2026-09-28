# 卷 71 — 对标第四十二轮续（V4「新卷出生即贴线」判红后续开，逐字迁移未压措辞）

## 新判据

`scripts/check-cron-health.mjs`（`npm run check:cron-health`）七腿 C1/C2/C3/C3b/C4/C5/C6：
声明面结构性枚举（禁手抄）⇄ 远端注册面双向对账；逐条三态 **OK / RED / UNVERIFIED**（rc 0/1/2，取不到数绝不记绿）；
连红只数 `event == 'schedule'`；**红因具名归口**（"N 条红 ⇄ M 个根因"印在门面行）；豁免三件套 = 限期 +
可证伪理由（复用 `lib/registry-reason`）+ `root_cause`，缺任一即红。登记册 `docs/cron-health.json` 与 YAML 互查。

自己抓自己的两处（都是"看起来成功的静默失效"）：
1. **枚举器漏面**：`uptime.yml` 的 `- cron:` 前面有注释行、`d1-backup.yml` 的 cron 行**后面**挂尾注释
   ⇒ 第一版一条能解析、一条整条静默不入面。正解不是补正则，是给枚举器加**反向断言**
   （有 `schedule:` 块却解不出 cron ⇒ 带 `unparsed` 入面，由 C2 点名 + C3b 判"入面数 == 含块文件数"）。
2. **被 cron 自己调用时**：当前 in_progress 的 run 结论是 `null` ⇒ 会被读成"最近一次失败"，
   刚修好几秒钟又自判红。加"排除自己的 run id + 未完成不入判定 + run 列表按去重数比 `total_count`，
   截断即 rc=2"（口径取自 `koala73/worldmonitor :: scripts/check-railway-reconcile-age.mjs:209,217-230`）。

夹具 `tests/cronHealth.test.js` **19 条**：正向 2 / 核心反例 5（含"手动 dispatch 不得洗白"）/ 取数面与登记面 5 /
豁免通道 4 / 周期解析 1 / **入口子进程 4**（`--fixture` 三档退出码 + `--inject-red` 演习必须判红）。
## R42-H1 / H2 的收口与新账

- **U5 每天假红一次**：初稿"日窗 0 而滚动 24h 非 0 ⇒ 一律可疑"，本机 **00:11 UTC 实跑 rc=1**；
  配额按 00:00 UTC 重置 ⇒ 头几小时必然落进这个形状。改判据不改数据：用**同一请求**里按 date 分组的
  history 腿做结构互检（**不加时间门**——时间门等于自己开一段盲区），四种出口各有断言
  （`tests/d1RemoteUsage.test.js` 9 条）。另补 `verdictOf` 的 `UNVERIFIED` 档 + 三档退出码：
  原 `process.exit(failed.length ? 1 : 0)` 会让新增的"失明"出口**静默变绿**。
- **穿透再扩一层**：`scanArtifactWrites` 原来只认裸标识符/字面量，本仓多数写法是
  `writeFileSync(join(ROOT, REGISTRY), …)`（表达式）⇒ 按括号深度取第一实参再解引用；
  受控产物写入者 2 → **5 件**（新增 `api-response-contract`、`check-cron-health`、`check-d1-remote-usage`），
  `verify-backend` 标签同步补 `writes-artifacts`（此前漏登）。
