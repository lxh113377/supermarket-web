# 07 分卷 39 —— 对标第二十七轮（2026-09-27）：action 响应形状有没有契约

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第二十七轮-2026-09-27.md`。
> 回滚锚 `53ea4d7`；备份 `/c/_sm_backups/r27-start-53ea4d7.bundle`。代码提交 `761f7d0`（pre-push 回执 GREEN base=53ea4d7）。

## 本轮立起来的东西
- `docs/api-response-contract.json`：30 条实测响应形状（信封键 / data 形态 / 顶层键；**交集=保证有、并集=可能出现**）。
  由 `verify-backend` 的 `wrapHandle`（本仓唯一 action 出口）带真实 payload 录制，不另起第二份真相源。
- 新门禁 `npm run verify:response`（V1~V6，已进 verify 链与 CI）：分母非零 / 流量⇄api-contract 幽灵 /
  未覆盖须具名（双向）/ 逐字段漂移 / **条件字段逐条具名** / 对象型必须有保证字段。
- 首跑抓到两笔真账：`batchUpdate/batchDelete` **成功分支形状从未被观测**（只以只读被拒出现过）⇒ 补真实批量写探针；
  `createProduct.stock` 是随 payload 出现的条件字段 ⇒ 入册并记下"消费方不读该返回值"的实测事实。

## 确证了一条更老的缺陷（本轮只止血，机制未归因）
C1 的 SQL 峰值基线**会随机变红**：连跑 5 次，每轮都有某个 action 比基线多 1，且抖动的 action 每轮换。
已排除：归因口径（换成 AsyncLocalStorage `runInSqlScope` 后仍抖）、`genId` 唯一性路径。
已确证：固定 `Math.random` 后 `A:createProduct` 6/6 恒为 3。
**机制未归因到底** ⇒ 只写"未归因"，不写解释。止血 = 基线与实测同口径 N=5 次采样取上界 + 带内(+1)只 WARN 不判红。
理由写在注释里：该闸目的是抓 N+1（一次 +商品数量级），绝不会只 +1；而"正常提交随机变红"会教人无视闸。

## 下一轮 P0（本轮未做）
1. R27-M1：把抖动归因到底（候选：未 await 的通知链、`seedReviews` 随机条数与后续 action 的交互、同毫秒 id 碰撞），
   拿到最小复现后**把噪声带收回 0**。
2. R27-M2：补 4 条已具备条件的成功形状（`verifyKey`/`addReview`/`deleteReview`/`getDashboardStats`），缺口 12 → 8。
3. R27-M3（上一轮的 M3 未做，如实记）：零分母普查换分母扩到 `report:*` 与运维脚本；三类覆盖数打进门面行。
4. R27-M4（仍受阻）：服务端 Required checks 需用户在分支保护里勾选。

## 本轮四处自失手（都已进 CHANGELOG 追加四十一）
批量替换写坏 `main()` 三行 / ESM 里又写 `require('node:fs')` / 夹具正向腿本要手抄清单（改派生）/
登记册新增行因列格式不符被解析器整行跳过（等于没登记，靠复跑发现）。
