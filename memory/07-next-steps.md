# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）已逐字迁至 `07-next-steps.part117.md`**（内层与本仓外层 `超市web/超市/memory/` 两套 07 内容不同，权威在内层）。

> 让位指针：第五十九轮正文 → `part118`（逐字 diff 2,008 B 全等）；第五十五~五十八轮四条让位指针 → `part119`
> （逐字回查 HEAD 4/4 命中）；本轮「做了哪三件」整段 → `part120`。第六十轮正文 → `part122`（经 `part121` 让位）。第六十一轮正文 → `part123`。V3 的正解是迁段不是压措辞。

## 2026-10-02 — 第六十二轮（event_log 读接口：getEventLog 上线）

- 轮初锚 内层 `2873b0b`（干净）；收尾见本轮提交。**零生产动作**（读接口只 SELECT；远端只做 SELECT 回读）。
- 交付：`functions/lib/actions/events.js`（getEventTimeline：orderId 必填＋limit 钳位 1..100 缺省 50）＋ backend 接线（case＋ADMIN_READ_ACTIONS 只读登记）＋ verify-backend L24~L26 ＋ client `getEventTimeline` ＋ `tests/eventLog.test.js` 3/3 ＋ 四份登记重生（api-contract 44 action／response 47 形状／openapi 44 paths／sql-baseline A:getEventLog=1）。
- 判据跟随：新 errorCode 零新增（复用 missing_order_id）；PII 零新增（覆盖表 event_log 已在册）；roundtrips 无需 REGISTER（单 SELECT 无循环，A7 干净）；钳位依据由代码注释载明（八类形状不含 Math.min 钳位，不立空登记行）。
- 附带：amortized:audit-retention-purge 基线 5→8（+3＝本轮 3 个新增 probe 调用各摊 1 条，工具 --update 实测，非手调）。
- 下一轮 P0：管理端时间线 UI 接线（调 getEventTimeline 展示；visual/e2e 基线随动由 UI 轮处理）；M-59-1 仍等真实订单；10-12 前 backup-liveness。拍板项延续（PAT×3/微信真机/密钥/CSP/R2/支付）只能用户手工。

## 更早轮次（第五十四轮及以前）的指针

> 三条历史指针已**逐字**寄存至 `07-next-steps.part107.md`（R54→卷 97/98、R53→卷 96、历史与在途项→卷 48）。
> 主卷只留当轮与上一轮，是为了给下一轮留余量——V3 判的就是这件事，别把它读成"历史不重要"。

## 分卷目录

- 在册卷号：1–123。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
  **本行由 `V5` 机器对账**（声明 ⇄ 磁盘双向差集）：改卷不并号，下一轮就会被判红。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上（第十七轮压缩史迁至卷 48）。
