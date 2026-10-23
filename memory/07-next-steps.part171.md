# 07-next-steps.part171 — 第七十八轮续（中优先两项：V4b 普查/性能定性 + 下一轮 P0）

> 自 part170 拆出（该卷初稿 4040B 违 V4 出生口径）；改造一/二见 part170。

## 改造三（中）V4b 出生即贴线普查
- `check-memory-volume.mjs` 新增 `--born`：`bornCensus`（`git log --diff-filter=A` + `git cat-file --batch-check` 两次批量）
  扫出生字节 >3072B 的作用面卷；`BORN_BASELINE` 棘轮在册 **22** 本（@2026-10-24 普查：part45 4081B…part8 3125B），基线外新增违例判红；
  历史不可达（浅克隆/非 git）⇒ UNVERIFIED 不折算"干净"；基线卷拆薄后可摘名（棘轮有减的出口）。
- 实测：`--all --born` GATE-PASS（181 出生事件｜22 违例全在册）；`memoryVolume.test.js` 48 passed（V4b 5 腿含两条方向相反的变异）。
- I-77-3 原案「V4 判新卷超限」由暂存面扩到普查面——只拦新增的 V4 管不到"出生即贴线的存量"。

## 改造四（中）跨日性能批次 + 载体修复
- `collect-live-perf` `resolveLighthouse` 不读 `~/.npmrc` 的 `cache=` ⇒ lighthouse 在盘（D:\app-cache\npm-cache\_npx）
  却报"没解析到"，本轮实测撞住（BLOCKED rc=1 零采样）。新增导出纯函数 `npmRcCache`（只认行首 `cache=`）进基数；
  `livePerfCollect.test.js` 9 passed（正反例：缺文件/无键/非行首 ⇒ null，命中返值）。
- t1806 跨日批（距上批 24 天）6/6 全采到，预飞两页 200。定性：
  ① admin/t1355 SI 8104.8 ⇒ t1806 中位 5275.7 ✓ **未复发**（单批尖峰）；
  ② customer/t2359 SRT 468 ⇒ t1806 中位 422.7 ✓ **未复发**（同批倍差 4.24× 属 simulate 噪声面）；
  ③ **新格** admin/t1806 SRT 567>450（超 26%）历史区间 198–245 ⇒ **待观察**，I-78-5 下一跨日批复测。
- 挂账 I-76-7/I-75-6 至此有结论（两格洗白 + 一格新账）。

## 下一轮 P0
- I-78-5：再采一个跨日批给 admin SRT 定性（连续两批越线才立回归；绿则销账）。
- I-78-6 可选：从 part45/46 两本贴死者开刀拆薄摘名（每轮 1–2 本，禁为绿压措辞）。
