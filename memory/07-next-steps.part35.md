# 07 分卷 35（第二十轮体量收口：第十八轮小节整段搬入，逐字保留）

## 2026-09-27 — 对标第十八轮（错误语义可编程性：57 个失败共用一个 -1，于是「库存不足」被渲染成「下单成功」）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十八轮-2026-09-27.md`；代码回滚锚 `fe7ab94`（第十七轮小节整段见分卷 34）。备份 `_backup/pre-round18-2026-09-27/pre-round18.bundle`（11,153,204B，bundle verify 全历史）。

- **一句话**：`functions/` 57 个失败出口共用 `{code:-1, message:中文}` 且 HTTP 恒 200 ⇒ `src/db/orders.ts` 的 catch 无法区分"服务端明确拒收"与"请求没送到"，一律 `addLocalOrder()` 本地兜底，而 `OrderSuccessPage` **从未读过 `localFallback`** ⇒ 库存不足的订单在顾客屏上显示「下单成功！请完成支付」并带「去支付」按钮，商家侧查不到这张单。已落地＝`functions/lib/errors.js`（33 码 × kind/HTTP/retryable）+ `docs/error-codes.md` 人读面 + 新门禁 `npm run verify:errors`（E1~E8，9 项 + 36 条双向变异夹具）+ `apiResponse()` 单点语义状态码（409/401/403/404/413/429+Retry-After/500）。**`code` 字段一个字未改**（旧 bundle 判 `code!==0`，换成 4xx 会让旧客户端把失败读成成功），E8 机器守住这条。
- **两条被自己的夹具抓回来的自错（写进报告 §8）**：① `FALLBACK_SAFE` 初版写成 `{platform}`，正例 `isFallbackSafe({})===true` 当场红 ⇒ 顾客端（GitHub Pages）与后端（Pages Functions）**分两次部署**，"没有码"必须按 transport 允许兜底，否则部署窗口期打断现网下单；② `fail()` 初版遇未登记码 `throw` —— `checkAuth`/`checkRate` 在 `handleAdmin` 的 try **之外**，一抛即 Pages 未捕获异常 ⇒ 改降级 platform + CI 判红（失败分支必须无能力失败）。
- **同时清掉第十七轮四条尾账**：**M6** `src/` 入上限普查面（40⇒63 项）—— 扩面当轮即抓出 ① `x.length>0`/`<1` 是**非空判断不是上限**（functions/ 里恰好零出现，一进 src/ 造 12 行假阳性 ⇒ 补 `EMPTY_TEST` 改机制，未调阈值未开豁免）② **评价配图 5-vs-3 不一致**：前端硬编码 5、屏上印「最多 5 张」、注释还声称"服务端 ≤5"，服务端一直是 >3 ⇒ 按屏上提示选到第 4 张整条被退回；收口 `MAX_REVIEW_IMAGES=3` + `tests/reviewImageCapContract.test.ts` 等号钉两侧。另修 **C7 空转判据**（旧断言的判据住在 scripts/ 永不进面 ⇒ 改为前缀回读 + src/ 正向对照）与补 **C8**（解析失败禁静默跳文件）。**M4** 根因改判并修复：不是厂商文案的"装在别的平台"，是 `@cloudflare/workerd-windows-64/bin/` 与 `@esbuild/win32-x64/` **只剩元数据、exe 被删**（两父目录 mtime 同为 09-27 03:38，全仓 `*.exe` 只剩 1 个）⇒ `npm pack` 取回两枚（只动 gitignore 的 node_modules，`git diff --quiet package-lock.json` 证与 HEAD 逐字节相同），`verify:functions` **本机首次跑绿**（98,401B、三入口齐备）。**M3** 档位登记补对账链；**M2** 按第十七轮"上限 40 + 前端分片"路线销账，**如实写明闭的不是原条目那句"n=200 语句 ≤3"**（bulk UPDATE 会丢 `{updated, failed[]}` 明细）。
- **P0（第十九轮开工先做这条）**
- [ ] **N3 部署（需老大一句话）**：本轮零线上动作。新后端（`errorCode` + 语义状态码）与新顾客端（分流 + 成功页 `localFallback` 横幅）**要各部署一次才生效**，顺序不敏感（前后端向后兼容已双向核：`client.ts` 读体不读 status、`sw.js` 绕过 /web /pub、`smoke` 只测成功路径）。按红线须先加载 `chaoshi-web-deploy` skill 取 checklist。部署前现网行为＝本轮修复前状态。

> 本卷按 4KB 上限拆分，后半段在 `07-next-steps.part44.md`（内容逐字未改，只做了整段搬移）。
