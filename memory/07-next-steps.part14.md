# 07-next-steps.part14.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **P0（下轮，只剩人工）**：**K3 仍未做** —— 线上管理端登录后目视复核看板四张图 + `#/product/{order}` 图集显示（只有用户能做）。本轮 CI 的 `e2e-cloud-stub` 已把"真渲染"变成机器判据，但跑的是本地假桩，**不等于线上已核**。
- **N4（新增，全局执行模型）**：vitest 默认 `testTimeout: 5000` 是墙钟，而每文件独占一个 jsdom（实测 63 个、占总时长 29–55%）+ `--coverage` 插桩 ⇒ **冷 `await import()` 页面块**的用例耗时随机器负载漂。本轮 `tests/prefetchBus.test.ts` 两条被撞红，已按"给这两条 20s 档"处理（附 WHY 注释，未动全局值）。治本候选：`pool: 'vmThreads'`（vitest 每次跑完自己都在提示）或 `isolate: false` 复用 jsdom —— 属执行模型改动，隔离语义有风险，**单独一轮评估**，别在补测试的轮次里顺手改。评估判据建议：连跑 5 次全量 `--coverage` 记录 wall time 与是否有 timeout，再决定。
- 待办不变：K4 PR 流试点、K5 diff-cover 增量覆盖率、K6 演示模式看板口径待裁决、K7 文件名大小写冲突自查脚本、D1↔seed 对账（以 D1 为源反推 seed）、order 41「光头娃/光头哇」生产行待订正、上架仅 28/55 素材口径、D2 49 单运营处置（人）、D4 `CF_D1_BACKUP_TOKEN`（用户）、D5 R2。



## 2026-09-25 — /shop 两阶段重构（结构 URL 化 + 暖白画廊视觉）

- **阶段一（`4e5d550`）**：筛选态收进 URL，TopNav 受控化，修掉 loading 期导航消失、页头与高亮不一致、55 个 aria-live 三个潜伏缺陷。用例 517→548。
- **阶段二（本次）**：「暖白画廊」视觉重做 —— 图注式卡片、两端各自设计、规格提升为独立行、价格 brand-700 修对比度、详情页面包屑改取真实分类。用例 548→**551**，`test:visual` 10→**15**。
- **P0（下轮）→ 已降级为本机注记（2026-09-25 防线轮实测归因）**：`dist-e2e` 的 preview 端口 4176 若被手工占用，Playwright `reuseExistingServer` 会**静默复用过期构建**（本轮实测踩到：netstat 没抓到 PID 但端口仍 200，视觉跑在旧产物上）。对策：跑视觉前先 `vite build --config vite.config.e2e.js --outDir dist-e2e` 重建，或在 CI 里加一步端口占用检测。**归因**：`playwright.visual.config.ts` 的 `reuseExistingServer: !process.env.CI` 在 CI 下恒为 false ⇒ 该风险**本机专属**，且 `test:visual` 未进 CI，不构成 CI 侧 P0。新增的 `playwright.stub.config.ts` 直接把该项设为**恒 false**（宁可响亮失败也不测旧产物），本机实跑即按设计拦下了一个上一会话遗留、伺服旧 `dist-stub` 的桩进程。

## 分卷目录
- **卷1** `07-next-steps.part13.md` — 07-next-steps 分卷（R199 自动拆卷）

