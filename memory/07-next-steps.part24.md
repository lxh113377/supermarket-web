# 07-next-steps.part24.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [x] **dependabot 6 条 PR 积压** —— ✅ **2026-09-26 已全部并完（#13–#18，开放 PR 清零）**，处置过程与判据：
  - **先判红因再动手**：初看六条全红，实测其中 **#13/#16/#17/#18 是 09-25 账号级停摆窗口的 `steps=0 / 2~3 秒即结束`** 形态（零信息量，不是判据红）；**#14/#15 是当日真跑**，但只红 `visual` 一项 —— 因其基线早于本仓 `394d680`（视觉判据重锚），属陈旧基线而非依赖回归。⇒ **六条的红都不能归因到依赖本身**。
  - **处置**：全部 `@dependabot rebase` 换基到含 `394d680` 的 main 后重跑 → 六条 **5 job 全绿（deploy 按 PR 事件正确 skip）** 才并；`package-lock.json` 是同文件，**必须严格串行**（并 #16 后 #17/#18 转 `DIRTY`，逐条 rebase→等绿→并，才清账）。合并方式 `--squash --delete-branch`。
  - **并后核验**：main 组合态 run `36222912408` **5 job 全 success 含 `deploy`**；`.github/workflows/ci.yml` 15 处 `uses:` **仍全部钉 40 位完整 SHA**（dependabot 未把 pin 退化成标签）；`package.json` = react-router-dom 7.18.4 / jsdom 30.1.1 / @testing-library/dom 10.4.2；github.io 侧 run `36222916395` conclusion=success。
  - **途中又抓到自己一类假证据**：双端探针复用同一个临时文件时，github.io `curl http=000/rc=28` 失败**不覆写文件**，grep 于是吐出上一条 pages.dev 的 `CACHE_VERSION` —— 差点写成"两端指纹一致已核验"。判据：**每次网络探针用独立文件 + 先 `rm -f` + 同时记录 `curl_rc` 与 `http` 码**，取不到就标未核（本机不可达 ≠ 未发布，后者看 deploy run 的 conclusion）。
- [ ] **N4 执行模型单独一轮**（本轮只量不改）：`--coverage` 全量跑出现 worker **OOM**（`Tests 625 passed` 却 `exit 1`，少收 1 个文件）= "全绿但 job 红"。已量：5 连跑不带 coverage 0 失败、wall 6.26–13.63s；本机 32 线程 × 每文件独占 jsdom 是分母。候选 `pool:'vmThreads'` / `isolate:false` / `maxWorkers`（CI 4 核故 CI 侧暂未复现）。**评估判据**：连跑 5 次全量 `--coverage` 记录 wall time + 是否 OOM/timeout，再决定；禁止用抬 `testTimeout` 掩盖机制缺陷。
- [ ] M3 `diff-cover` 增量覆盖率：本机未装该工具，按"未实跑的命令不得当门禁依据"未接。做法：先本地装并跑通一次（对 `coverage/` 需要 cobertura 报告器），量一轮误报率，再作为**报告型** step 进 CI（不作阻断），成熟后再接 `--fail-under`。
- [ ] 不变项：K3 线上管理端目视复核（需生产密钥，转 public 后已轮换，本机 `.dev.vars` 是否为新值**未实测**）、K4 PR 流试点（现成场景：从 dependabot PR 开始试）、D1↔seed 对账、order 41 生产行订正、28/55 上架口径、D2 49 单运营处置（人）、`CF_D1_BACKUP_TOKEN`（**注意新守卫：仓库非 private 时配了也会红**，先选两条出路之一）、R2 桶。



## P0 — 当前阻塞（历史；本轮已全部解开，留档勿改）

> 本节标题在第八轮一次编辑中被锚点吞掉过（`## 标题行`当 old_string 却没回写），已补回。
> 现状：`0b9e405` 与 `d598cf8` 两笔均已随 run `36219254275` 的 `deploy` job 上线（pages.dev 已发新构建，`dispatch.yml` run `36219254276` success）。
