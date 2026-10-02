# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）已逐字迁至 `07-next-steps.part117.md`**（内层与本仓外层 `超市web/超市/memory/` 两套 07 内容不同，权威在内层）。

> 让位指针：第五十九轮正文 → `part118`（逐字 diff 2,008 B 全等）；第五十五~五十八轮四条让位指针 → `part119`
> （逐字回查 HEAD 4/4 命中）；本轮「做了哪三件」整段 → `part120`。第六十轮正文 → `part122`（经 `part121` 让位）。V3 的正解是迁段不是压措辞。

## 2026-10-02 — 第六十一轮（收尾在途半成品：event_sink 真 D1 驱动验证）

- 轮初锚 内层 `ec8b298`（=origin/main，工作树 6 件在途：4 改 + 2 未跟踪，上一会话未提交）；收尾见本轮提交。**未执行生产动作**（探针 `persist:false` 内存态，零远端调用）。
- H-61-3：`scripts/verify-event-sink-d1.mjs` ＋ `tests/eventSinkD1.test.js` ＋ `verify:event-sink` 进 verify 链 ＋ README/cli-entrypoints/doc-commands 三处登记。修因：59/60 轮 §8 判据等真实订单流量（n=0 窗口无事件）永不可主动闭合。
- 实测：selftest 9/9；正例 rc=0 读回 n=1/total12.5/disc2/paid；反向 rc=1 点名 no such table；vitest 3/3；entrypoints 14/14；doc-commands --check OK；backend 188/188。收尾中修：新夹具裸 spawn 致欠账 0→1 ＋ guard 报未入库 ⇒ 接 `assertCliRan` 守卫 ＋ 显式 git add，重跑全过。
- 全量 `npm test`：118过/4文件7失败，其中 4 项即上条已修；余 `ciStatusRedaction` 3 腿系 curl 死代理超时环境形态（两文件均不在本轮 diff 内）⇒ 不拦收尾，记待观察。
- 下一轮 P0：远端 `SELECT COUNT(*) AS n, MAX(at) AS last_at FROM event_log`（n=0 且期间有订单 ⇒ 查 event_sink 错误日志；n>0 ⇒ M-59-1 关闭）。**61轮补测（2026-10-02 实测）**：event_log n=0/last_at=null；orders n=62、last=`2026-10-01T12:44:00.682Z`，早于含 sink 部署上线（18:41Z）⇒ 窗口内无订单，n=0 无信息量，M-59-1 保持 open（禁拿此 n=0 当"写路径坏"）。10-12 前 `npm run check:backup-liveness`。拍板项延续（PAT×3/微信真机/密钥/CSP/R2/支付）只能用户手工。

## 更早轮次（第五十四轮及以前）的指针

> 三条历史指针已**逐字**寄存至 `07-next-steps.part107.md`（R54→卷 97/98、R53→卷 96、历史与在途项→卷 48）。
> 主卷只留当轮与上一轮，是为了给下一轮留余量——V3 判的就是这件事，别把它读成"历史不重要"。

## 分卷目录

- 在册卷号：1–122。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
  **本行由 `V5` 机器对账**（声明 ⇄ 磁盘双向差集）：改卷不并号，下一轮就会被判红。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上（第十七轮压缩史迁至卷 48）。
