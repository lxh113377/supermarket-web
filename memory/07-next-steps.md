# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）已逐字迁至 `07-next-steps.part117.md`**（内层与本仓外层 `超市web/超市/memory/` 两套 07 内容不同，权威在内层）。


## 2026-10-03 — 第六十四轮（接管在途件 + 三条机制落地）

- 轮初锚 内层 `ccebafa`（工作树 2 件在途）/ 外层 `7b6ead7`。**零生产动作**（只两条 `SELECT`，无 migrate/deploy/secret）。
- 接管在途：`src/components/OrdersTab.tsx`（62 轮 P0「管理端时间线 UI」的 86 行半成品，mtime 落后 HEAD 9h、
  `find -newermt "-15 minutes"` 空 ⇒ 中断遗留非并发在途）→ 补 `tests/ordersTab.test.tsx` 6 条 +
  `tests/ordersTab.test.tsx`/`tests/ordersTabStale.test.tsx` 两处 `vi.mock('../src/db')` 缺的 `getEventTimeline` 导出。
  变异腿：摘缓存守卫 ⇒ rc=1（`called 1 times, but got 2`）；按 sha256 `fc432a271a2fd121` 载回断言相等。提交 `8e5e603`。
- 本轮另两件事的明细整段在 `part125`（① 机制三条：`check:inflight` / 外层体量两侧分母 / 对外回显 3 处收口 + V4 可归因性；
  ② 判据跟随：backend 191→195、entrypoints 58→59、README 与 doc-commands 由生成器跟）。

- **新发现未修（G-64-1）**：轮次号有两个真相源 —— `CHANGELOG.md:7` 已写「第六十三轮」（`c995366..ccebafa`），
  内层主卷最新节仍是第六十二轮，而 `verify:pointers` 两侧取数面只解析 `07-next-steps*.md` 的 `## …第N轮`
  ⇒ 它印「内层 62｜外层 62｜已核对 2/2」PASS，CHANGELOG 根本不在它的面里。本轮避让为第六十四轮，机制未修（理由见报告 §7 第 4 条）。
- 下一轮 P0：**开工第一动作先 `npm run check:inflight`**；主条 = 给 `check-memory-pointer-sync.mjs` 加第三取数面
  （CHANGELOG 声明轮号 ⇄ 内层主卷最新轮号 ⇄ 外层指针节 三面归属先定权威，再写双向差集；只改 CHANGELOG 不改记忆必须红）。
  次条 = `event_log` 真流量回读，**两条读数同时取**（`n` 与 `MAX(orders.createdAt)`）；`n=0` 且后者早于 2026-10-01T18:00Z ⇒ 未到点，不判坏。
  10-12 前 `check:backup-liveness`（本轮本机实测 **rc=2=量不到**，不得读成绿；缺 `CF_D1_BACKUP_TOKEN` 只能用户配）。
  拍板项延续（PAT×3/微信真机/密钥/CSP/R2/支付/trace 对外文案）只能用户手工。
- 让位指针：第六十二轮正文 → `part124`（逐字 `endswith` 验 True，1,318 B）；
  本轮「机制三条」(909B) +「判据跟随」(277B) + 段首让位指针段 (373B) → `part125`（三段逐字迁移，未压措辞、未删事实）。


## 更早轮次（第五十四轮及以前）的指针

> 三条历史指针已**逐字**寄存至 `07-next-steps.part107.md`（R54→卷 97/98、R53→卷 96、历史与在途项→卷 48）。
> 主卷只留当轮与上一轮，是为了给下一轮留余量——V3 判的就是这件事，别把它读成"历史不重要"。

## 分卷目录

- 在册卷号：1–127。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
  **本行由 `V5` 机器对账**（声明 ⇄ 磁盘双向差集）：改卷不并号，下一轮就会被判红。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上（第十七轮压缩史迁至卷 48）。
