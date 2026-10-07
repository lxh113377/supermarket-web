# 07-next-steps · 第七十一轮 · 第 2、3 项详情（P5 外层归档面 / cron 登记册 C7+C8）

> 接 `07-next-steps.part153.md`（第七十一轮正文）。本卷第 2 项是从该卷**整条迁出**的，逐字未压措辞。

2. **【高】`verify:pointers` 加 P5「外层归档面」。**
   P2 判的是"外层台账**内容**跟没跟上轮次"，第七十轮栽的是另一半：那份报告在磁盘上、内容也对，
   但在外层 git 里是 `??`、台账是 `M` ⇒ **P2 绿不等于账还了**（这是台账漂移第 6 次复发，形态是新的）。
   规则：R−1 编号报告必须已被外层跟踪；R 报告只查存在性（宽限一轮，循环次序就是 报告→内层提交→外层提交）；
   归档面 dirty 逐件点名并给 `git add` 原文；外层不在 / git 取数失败 / 没注入探针 ⇒ 一律 UNVERIFIED。
   牙齿由**真实 red→green** 证明：该腿落地当刻实测 `FAIL P5（M 超市/memory/07-next-steps.md）`，
   外层还账提交 `b535a27` 后转 `PASS`，`已核对 5/5`。它挂在 pre-commit 第 5 条腿上 ⇒ 不改钩子就有提交时刻牙齿。
   ⚠️ `main()` 的 `gitRunner = null` 默认值被 `typeof === 'function'` 回落成"读真归档仓"，
   合成外层夹具会串台 ⇒ 改用 `undefined` 当"未提供"哨兵，显式 null 就是显式 null。

## 第 3 项（cron 登记册 C7 新鲜度 + C8 失败 step 双向对账）

3. **【中】`check:cron-health` 加 C7 新鲜度 + C8「在册失败 step ⇄ 当次实测」。**
   一手：`docs/cron-health.json` 的 `generatedUtc` 停在 10-04、`observed_last_run` 落后现实 3 夜，
   而 grep 全仓**没有任何判据读这三个字段**（只有 `--update` 写它）。人填的豁免理由是照着册上读数写的，
   读数过期 = 理由是照着旧事实写的，而 C4 只查它"可不可证伪"、不查它"还对不对得上今天"。
   C7 走 **rc=2（UNVERIFIED）而不是 rc=1（RED）**：过期的的是**证据**，不是某条 cron 病了 ——
   与 C1/C2/C5 同列，把工具缺陷伪装成产品故障是本仓明令禁止的一族。
   C8 三个计数一律进门面行、**默认不翻转 rc**，`--require-reason-match` 是**到期轮（10-12）才拧**的开关。
   ⚠️ 本轮实测证明**两条在册理由今天仍然为真**（uptime 的理由点名 `Backup chain liveness (…)`，
   `/jobs` 实测 step 7 正是它 failure）⇒ 一个字都没改理由文本；改它既无事实依据，又是"改豁免让它好看"。
   ⚠️ 取不到 step 明细时**不写 `observed_failing_steps` 这个键**，而不是写成 `[]` —— 缺键 = 未复核，
   空数组 = 复核过且没有失败步骤，两者同形就会把"没查"读成"查了没问题"。
> 本卷第 4 项（**`report:remote-divergence` 通道普查**）整条迁去 `07-next-steps.part156.md`。
> 迁卷理由同 V4：本卷落在 3492B > 3072B；口径 = 整条不拆、逐字迁。
