# 07-next-steps.part12.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **H1/H2 全做完**：新增 11 个测试文件 +134 用例（319→**453**，56 文件）；覆盖率 statements 57.25→**74.71%**、branches 68.76、functions 69.81、lines **76.39%**，棘轮上调 **74/68/69/76**（statements/funcs/lines 双跑一致；branches 差 1 条 5s 轮询时序分支 ⇒ 阈值留余量）。OrdersTab 44→97.34%、ProductsTab 48→88.88%、详情页/评价链/图集/遮罩/登录闸/预取总线/图片压缩全部从 0 或低位补上。
- **修掉一个真实错图缺陷**：`ProductGallery` 在 `gallery.length === 1` 时走"按 order 拼路径"分支，忽略调用方传入的图 ⇒ 只挂一张自定义图的商品详情页显示错图。改为 `singleSrc = gallery.length===1 ? gallery[0] : imgSrc`，srcSet 仅在该图确为 order 路径图时挂（外链无 sm/ 版本）。
- **我自己造成并自纠的回归（重要教训）**：`tests/productsTab.test.tsx` 与既有 `tests/ProductsTab.test.tsx` 在 Windows 大小写不敏感文件系统上是同一文件 → Write 静默覆盖旧 4 例（`git status` 表现为 `M` 而非 `??`，这个信号当时没抓住）。4 例已并回（20→24）+ `git mv` 归一大小写。**纪律**：新建测试文件前先核对同名（不分大小写）文件；`M` 状态的"新文件"＝覆盖事故。
- 判据层经验复用成功两处：CSV BOM 必须**字节层**断言（jsdom `Blob.text()` 按规范吞 BOM，字符串比对会假失败）；Overlay 焦点陷阱需把 `offsetParent` 定义成"有父元素即可见"才在 jsdom 里可测。
- 门禁：verify 全链绿、体积 3/3（首屏 86.4KB 未变）、e2e 8/8、verify-backend 102/102；提交 `fc06cd5` + `e9d7665`。报告：外层 `deliverables/GitHub开源项目对标分析报告-第七轮-2026-09-25.md`。
- **P0（下轮 K1）✅ 已执行 2026-09-25（防线轮）**：`src/auth.ts`(16%) + `api/client.ts`(9.5%) + `localStore.ts`(~53%) 门面专项——注入假 fetch 测超时/非 JSON/code 缺失/网络抛错；写操作失败也必须失效目录缓存这条不变式要断言。预计再 +4~6pp。[推荐:R197-01]（agent 自动）
- **K2（高，agent 自动）✅ 已执行 2026-09-25（防线轮，并额外把 job 接进了 `deploy.needs`）**：把真浏览器层接进 CI——新 job 跑 `build:stub` + `serve:stub` + playwright 访 `#/admin`，断言 4 个 canvas 尺寸非零且控制台无 TypeError（防第六轮那类"单测全绿线上空白"复发的机器型落点）。
- **K3（用户 1 分钟）**：线上管理端登录后目视复核看板四张图 + `#/product/{order}` 图集显示（本轮改了图集分支）。[推荐:R197-02]
- P1：K4 PR 流试点（本轮两条缺陷仍都是"合并后发现"）、K5 diff-cover 增量覆盖率、K6 演示模式看板口径待裁决、K7 文件名大小写冲突自查脚本。
- 不变：D2 49 单运营处置（人）、D4 `CF_D1_BACKUP_TOKEN`（用户）、D5 R2、changesets 仅观察。

## 2026-09-24 — 对标第六轮（图表可测性重构 + 两处"判据假安全感"P0）

## 分卷目录
- **卷1** `07-next-steps.part11.md` — 07-next-steps 分卷（R199 自动拆卷）

