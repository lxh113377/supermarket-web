# 07-next-steps.part17.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [ ] **`d598cf8`（可选规格收敛 + 后台口味开关）已提交已推送、生产 D1 已迁移，但两端前端未发版** —— 拦在同上一条账号级 CI 停摆（run `36125547534` 三 job 全 0-step；`dispatch.yml` run `36125547517` 同样 0-step ⇒ github.io 未被触发）。
  - **已完成的部分（有实测）**：`products.specOptions` 迁移经 `node scripts/migrate.mjs apply --remote --yes` 落库（账目表已记 `migrate-spec-options.sql`；执行前 `d1 export` 全量备份 `_backup/supermarket-d1-pre-specoptions-20260925-184136.sql`，1,449,663 B / 949 条 INSERT）；线上回读核验 4 款薯片（33/34/40/52）带口味、其余含全部饮品为 `[]`；`/pub getPublicProducts` 仍 HTTP 200、28 条上架、无回归（旧后端不引用新列 ⇒ 迁移是加法，**当前线上是一致可用状态**，不是半发布）。
  - **未发的部分**：pages.dev 与 github.io 仍是 `5ea17e0` 期构建 —— 顾客端还看不到 4 款薯片口味、饮品规格选择器也未消失（**口味数据已在库里但线上前端读不到**，旧 `getPublicProducts` 的 SELECT 不含该列）。
  - **可执行指令（按序）**：① 用户处理 Billing & plans；② `gh`/API `POST /repos/lxh113377/supermarket-web/actions/runs/36125547534/rerun-failed-jobs`（或 `workflow_dispatch` 跑一次完整 CI）⇒ CI 绿后自动 `wrangler pages deploy` 发 pages.dev，并经 `dispatch.yml` → github.io `deploy.yml` 发顾客端；③ 按部署 skill §6 核 ①②③④⑥⑦⑧ + 两端 `sw.js` 的 `CACHE_VERSION` 变新 + 产物级判据（`ProductDetailPage-*.js` 里应能 grep 到 `specOptions`）才算上线；④ 若用户点名急救通道，则本地 `npm run build` + `node node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=supermarket-web --commit-dirty=true`，**并如实记为"绕过 CI 发版"**。

## 分卷目录
- **卷1** `07-next-steps.part16.md` — 07-next-steps 分卷（R199 自动拆卷）

