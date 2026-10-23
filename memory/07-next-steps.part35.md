# 07 分卷 35（第二十轮体量收口：第十八轮小节整段搬入，逐字保留）

## 2026-09-27 — 对标第十八轮（错误语义可编程性：57 个失败共用一个 -1，于是「库存不足」被渲染成「下单成功」）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十八轮-2026-09-27.md`；代码回滚锚 `fe7ab94`（第十七轮小节整段见分卷 34）。备份 `_backup/pre-round18-2026-09-27/pre-round18.bundle`（11,153,204B，bundle verify 全历史）。

- **一句话**：`functions/` 57 个失败出口共用 `{code:-1, message:中文}` 且 HTTP 恒 200 ⇒ `src/db/orders.ts` 的 catch 无法区分"服务端明确拒收"与"请求没送到"，一律 `addLocalOrder()` 本地兜底，而 `OrderSuccessPage` **从未读过 `localFallback`** ⇒ 库存不足的订单在顾客屏上显示「下单成功！请完成支付」并带「去支付」按钮，商家侧查不到这张单。已落地＝`functions/lib/errors.js`（33 码 × kind/HTTP/retryable）+ `docs/error-codes.md` 人读面 + 新门禁 `npm run verify:errors`（E1~E8，9 项 + 36 条双向变异夹具）+ `apiResponse()` 单点语义状态码（409/401/403/404/413/429+Retry-After/500）。**`code` 字段一个字未改**（旧 bundle 判 `code!==0`，换成 4xx 会让旧客户端把失败读成成功），E8 机器守住这条。
- **两条被自己的夹具抓回来的自错（写进报告 §8）**：① `FALLBACK_SAFE` 初版写成 `{platform}`，正例 `isFallbackSafe({})===true` 当场红 ⇒ 顾客端（GitHub Pages）与后端（Pages Functions）**分两次部署**，"没有码"必须按 transport 允许兜底，否则部署窗口期打断现网下单；② `fail()` 初版遇未登记码 `throw` —— `checkAuth`/`checkRate` 在 `handleAdmin` 的 try **之外**，一抛即 Pages 未捕获异常 ⇒ 改降级 platform + CI 判红（失败分支必须无能力失败）。## 后半卷

- 本节之后的全部段落逐字迁至 `07-next-steps.part175.md`（I-78-6 拆薄，迁出零删句）。
