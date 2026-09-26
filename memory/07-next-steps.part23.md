# 07-next-steps.part23.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [ ] M2 CoC 降级为**不做**（实测对标组 1/8 有）、M3 diff-cover **不做**（0/8 在 CI 卡覆盖率 + 本机无该工具，不静默装系统依赖）。
- [ ] 不变项：K3 线上目视复核（要生产密钥）、D1↔seed 对账、order 41 生产行订正、28/55 上架口径、D2 49 单运营处置（人）、`CF_D1_BACKUP_TOKEN`（注意非 private 会响亮失败的新守卫）、R2 桶。



## 2026-09-26 — 对标第八轮（提交 `085ec34` + `394d680`，CI run `36219254275` 五 job 全绿含新 visual）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第八轮-2026-09-26.md`；备份 `_backup/pre-round8-2026-09-26/`（bundle + 原件）。

- **已落地并接闸**：`verify:case`（大小写冲突）/ `verify:docs`（文档事实对账真相源）/ `verify:functions`（Pages Functions 编译产物，零部署）三段进 `npm run verify` 与 CI；CHANGELOG 门禁改 `before..HEAD` 整段区间；5 个浏览器 spec 统一 `watchErrors()` 且**错误自此产断言**；`localStore` 四个读出口全拷贝；`visual` job 进 `deploy.needs`（现 4 needs）+ `reuseExistingServer` 恒 false；`d1-backup.yml` 加"非 private 禁止上传全库明文导出物"的 fail-closed 守卫。
- **两条纠偏记在账上**：① 我自造的假缺口 —— 声称"CI 不跑 `verify:backend`"，实为我 grep 的是 npm 别名、`ci.yml:103` 一直写着脚本路径 ⇒ 已在 README 的承诺核对里撤回；② 派出的调研 agent 建议"借鉴 saleor 钉 SHA"，实测本仓 12 处 `uses:` 早已全钉 40 位 SHA。**同族**：Lighthouse 指标预算经 9 仓实测为 0 家在卡，前七轮记为"差距"不成立。
- **本轮最硬的一条**：M4 把 `test:visual` 接进 CI 的**当天**，CI 报 4 红，而我本地同轮报的是"16/16 全绿" —— 强制重建 `dist-e2e` 后本地同样 4 红，证实那次全绿跑在过期产物上。根因是上一轮 `d598cf8` 删数据后 3 条视觉判据失去驱动数据、1 条断言与代码相反（主图刻意 `eager`）。**⇒ 判据不接线就等于没有；本地跑"绿"必须带产物新鲜度证据。**

### P0（第九轮开工先做这条，可执行）

- [ ] **`:169` 口味色块判据目前是 `test.skip`**：`src/data/variants-demo.ts` 两个组都是 `kind:'spec'`，全站再无 `color` 轴 ⇒ 判据有效但无数据驱动。做法二选一：① 上线任意一条带色块的规格数据后**解除 skip**并实测；② 若确定产品不再需要色块轴，则连同 `tests/variants.test.ts` 里那组**空转真**的色块断言一起删干净（勿只留 skip 注释）。命令：`grep -n "kind: 'color'\|test.skip" src/data/variants-demo.ts tests/e2e-visual/layout.spec.ts tests/variants.test.ts`
