# 07-next-steps.part19.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **⚠️ 事实更正（覆盖第十一轮我自己写的话）**：`D1 Daily Backup` 自建链以来 2 次 run **全是 success 但 0 artifact**，导出/上传两步 `skipped` —— 根因是未配 `CF_D1_BACKUP_TOKEN` 时 `Detect backup token` 只发 `::warning::`。**第十一轮我写的"非 private 会先响亮失败、走不到导出"是错的**：那条守卫自带 `if: found == 'true'`，token 缺席时**它也被跳过** ⇒ 响亮失败从未发生。生产库至今**没有任何自动备份**，盘上唯一真备份是 09-25 手动导出（1,449,663B / 949 INSERT）。
- **已落地**：`scripts/check-backup-liveness.mjs`（`npm run check:backup-liveness`；不信 conclusion，要求"导出步骤 success + artifact≥1 + run success 且 ≤2 天"；零 run 判红；workflow 用文件名 `d1-backup.yml` 免配 ID）+ 接进 `Uptime`（带 `GH_TOKEN` 与 job 级 `actions: read`）；`d1-backup.yml` 加 `Fail loudly instead of reporting a green no-op`（未配 token 且未设 `BACKUP_SKIP_OK=true` ⇒ exit 1，**默认响亮**）；`report:catalog` 摘掉 `continue-on-error` 接成阻断（两轮样本逐项一致：28/54、漂移 27+1+22、重复 3+3）；`tests/backupLiveness.test.js` 12 条、`ciWorkflow.test.ts` 30 条（新增"自动化链接线契约"组，四种抽键反例各点名）。
- **两处自纠**：① **注释冒充判据** —— 反例"抽掉 `actions: read`"测不出问题，因为 YAML **注释**里也写了这个短语；判据一律改用行首锚定键形态。② **CRLF 又咬一口** —— 夹具变异正则在 CRLF 工作文本上匹配不到，"抽掉"成了空操作 ⇒ 变异前先归一。
- **体量体检（A-project-handoff `volume`）本轮首次入册**：整仓 463MB（node_modules 415MB 占 99%）、`memory/07-next-steps.md` **76,088B**、`2026-09-26.md` 19,502B、`05-feature-status.md` 7,789B、`dist-verify/` 5.6MB ⇒ `[GATE:volume-warn] 5 项`。处置见下方 P0 第 3 条。

### P0（第十三轮开工先做这条，可执行）

- [x] **备份路线仍未解（需人）** —— 但"红着等"已实测成立：合并后手动触发 `D1 Daily Backup`（run `36242719500`）**当场 failure**，错误原文点名两出路；60 天自动禁用 schedule 那条也已用官方文档核实原文（`In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days.`，来源 docs.github.com/.../disable-and-enable-workflows）⇒ 互指设计的前提成立。**本轮已把这条教训反哺进 `A-project-better` V1.12.0 核验铁律第⑤条。**：配 `CF_D1_BACKUP_TOKEN` 之前，`D1 Daily Backup` 与 `Uptime` 会每天判红——这是设计意图。二选一：①仓库转回 private；②导出后加密（age/openssl）再上传。任一完成后用 `gh workflow run "D1 Daily Backup"` 手动跑，要求看到 `Export=success` + `artifact=1` + `verify:restore` 演练步骤 success（**这才是恢复演练判据第一次在 CI 真跑**）。命令：`gh run list --workflow "D1 Daily Backup" --limit 3 --json conclusion,status` 与 `npm run check:backup-liveness`
