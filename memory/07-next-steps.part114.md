# 07 分卷 114 —— 第五十七轮收尾补记（自卷 113 整段迁出）

> 迁出原因：卷 113 被追加到 4,913B 超 4,096B 硬顶（V2 拦下提交）。
> 直接原因是"先写后量"——正解是先算本批字节再决定换不换卷，本轮由判据替我发现了。

## 收尾补记（同轮第二、三笔：安全修复 + 两处随动，以及一个未闭环）

- **安全事件（本轮实测，已修）**：`scripts/ci-status.mjs` 失败路径把一枚**可用 PAT 明文**打进终端与对话。
  根因不是"打印没脱敏"，而是 **token 进了 argv**——`execFileSync` 失败时 Node 把整条命令
  （含 `-H "Authorization: Bearer ghp_…"`）写进 `error.message`，而 argv 同机其他进程也可读。
  修法：敏感头改走 `curl --config -`（stdin 不进进程参数）+ 失败走本件自己的 `fail(…,4)` 出口 + 再脱敏 `error.message`；
  回归件 `tests/ciStatusRedaction.test.js` 是"对照 + 被测"四条腿（腿⓪ 用老办法证明泄漏面可观测，腿① 才证明修好）。
  **需用户执行**：该 PAT 建议撤销重发；已实测跟踪面 `git grep` 与 `_backup/*.log` **0 命中**（未落进被提交文件）。
- **两处随动由判据自己抓出（不是我记性好）**：`verify:docs` 说 README 单测文件数 114≠115（新增测试文件）；
  `verify:entrypoints` G2 说 `docs/cli-entrypoints.md` 里 `ci-status.mjs` 成了**幽灵缺口**——
  新回归件把它真跑过了 ⇒ 缺口 12→11、入口普查 14/14。这条正好印证本轮报告 §3 那句：
  **加一处东西就要跟着改几处文档/名册**（本轮现算基数 13 JSON + 5 md + 33 腿）。
- **未闭环（阻塞在用户侧，不是代码）**：本地共 3 笔未推 —— 内层 `07bbd44`（安全修复）、
  其随动笔（README/entrypoints 追平）、外层 `3abc0e2`（报告 §9/§10）。远端 `main` 仍停在 `e496a6f`。
  归因实测：`http.proxy=127.0.0.1:7897` 而该端口不通（`/dev/tcp` 探测失败 ⇒ Clash 退出），直连被墙；
  同会话早前多次 push 成功 ⇒ 不是配置漂移。复算入口＝启动 Clash 后
  `cd supermarket-web && git push origin HEAD && git ls-remote origin refs/heads/main`（两值须相等），
  再 `node scripts/ci-status.mjs` 读回 run。
- 全链最终读数：`npm run verify` 单趟 **FINAL_RC=0**，**115** 文件 / **1621** 用例（含安全修复与两个新测试文件）。
