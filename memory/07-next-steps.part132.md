> 建卷理由（第六十五轮 V4「新卷须 ≤3,072B」）：本卷内容逐字来自 `07-next-steps.part129.md` 第 4 段，按 `### ` 小节为原子单位拆卷（一小节不拆）。

### 四、下一轮（第六十六轮）开工的第一条

0. **P0 前置（本轮收尾时新出，优先级高于下面全部）**：远端 CI run `37143828059`（head `fbc8b04`）
   **红在 step「Dependency audit (npm audit, high+)」** ⇒ `deploy` 与 `Release parity` 双双 skipped，
   本轮改动**未上线**（`/_health` 的 `deploy` 仍是 `2e950ed`）。
   先取 advisory 明细再决定升级哪一条：本机 `npm audit` 走 npmmirror 镜像、
   `/-/npm/v1/security/*` 返回 `[NOT_IMPLEMENTED]` ⇒ **这台机器量不到**，
   要么读该 step 的完整 job 日志，要么在能连官方 registry 的通道上跑 `npm audit --json`。
   **禁**为变绿调低阈值、改 `audit:deps` 判据或 `--no-verify`。
   pre-push 的 `ci-green` 下一轮会以 `fbc8b04` 为 base 判红并**拦住提交** ⇒ 这条红不需要人记得，闸会记。

1. **P0 = M-64-2 生产回读，两条读数同时取**：
   `node node_modules/wrangler/bin/wrangler.js d1 execute supermarket --remote --json --command "SELECT (SELECT COUNT(*) FROM event_log) AS n, (SELECT MAX(createdAt) FROM orders) AS last_order"`
   —— `n=0` 且 `last_order` 早于 2026-10-01T18:00Z ⇒ **未到点**，不判坏；`last_order` 晚于它且 `n=0` ⇒ 写路径有缺陷。
2. **性能批次已到点**：cadence 7 天，上批 09-30 ⇒ 最早 **10-07** 才可采第二批；10-04 仍未到点，别提前采。
3. `check:inflight` 仍是 advisory（G-64-2「能采不能拦」未变）；升档条件是攒够几轮读数 + 误报率，
   且"升不升"是人决策。**10-03 与 10-04 两次都是它在开工时点出在途件**，读数已在累积。
4. 硬到期 **2026-10-12**：`CF_D1_BACKUP_TOKEN` 只能用户配（要登录 Cloudflare 控制台）；
   agent 侧只提醒并留痕，`check:backup-liveness` 本机恒 rc=2=量不到，不得读成绿。
5. 中档延续：M-64-6（trace 报障码的对外文案，要的是用户拍板不是胆量）、
   上表 §二的「折叠具名」结构性看守、`createProduct` 文本字段**无长度上限**（本轮实测：
   90,000 字符的 `MAX_STATEMENT_PAYLOAD_CHARS` 只加在 orders/reviews/submissions 三处，
   商品 name/description 不在其内 —— 这是**入库面**缺口，与回显不同类，需先定产品口径再动）。
