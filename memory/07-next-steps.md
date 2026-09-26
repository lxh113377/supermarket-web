# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。

## 2026-09-27 — 对标第十八轮（错误语义可编程性：57 个失败共用一个 -1，于是「库存不足」被渲染成「下单成功」）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十八轮-2026-09-27.md`；代码回滚锚 `fe7ab94`（第十七轮小节整段见分卷 34）。备份 `_backup/pre-round18-2026-09-27/pre-round18.bundle`（11,153,204B，bundle verify 全历史）。

- **一句话**：`functions/` 57 个失败出口共用 `{code:-1, message:中文}` 且 HTTP 恒 200 ⇒ `src/db/orders.ts` 的 catch 无法区分"服务端明确拒收"与"请求没送到"，一律 `addLocalOrder()` 本地兜底，而 `OrderSuccessPage` **从未读过 `localFallback`** ⇒ 库存不足的订单在顾客屏上显示「下单成功！请完成支付」并带「去支付」按钮，商家侧查不到这张单。已落地＝`functions/lib/errors.js`（33 码 × kind/HTTP/retryable）+ `docs/error-codes.md` 人读面 + 新门禁 `npm run verify:errors`（E1~E8，9 项 + 36 条双向变异夹具）+ `apiResponse()` 单点语义状态码（409/401/403/404/413/429+Retry-After/500）。**`code` 字段一个字未改**（旧 bundle 判 `code!==0`，换成 4xx 会让旧客户端把失败读成成功），E8 机器守住这条。
- **两条被自己的夹具抓回来的自错（写进报告 §8）**：① `FALLBACK_SAFE` 初版写成 `{platform}`，正例 `isFallbackSafe({})===true` 当场红 ⇒ 顾客端（GitHub Pages）与后端（Pages Functions）**分两次部署**，"没有码"必须按 transport 允许兜底，否则部署窗口期打断现网下单；② `fail()` 初版遇未登记码 `throw` —— `checkAuth`/`checkRate` 在 `handleAdmin` 的 try **之外**，一抛即 Pages 未捕获异常 ⇒ 改降级 platform + CI 判红（失败分支必须无能力失败）。
- **同时清掉第十七轮四条尾账**：**M6** `src/` 入上限普查面（40⇒63 项）—— 扩面当轮即抓出 ① `x.length>0`/`<1` 是**非空判断不是上限**（functions/ 里恰好零出现，一进 src/ 造 12 行假阳性 ⇒ 补 `EMPTY_TEST` 改机制，未调阈值未开豁免）② **评价配图 5-vs-3 不一致**：前端硬编码 5、屏上印「最多 5 张」、注释还声称"服务端 ≤5"，服务端一直是 >3 ⇒ 按屏上提示选到第 4 张整条被退回；收口 `MAX_REVIEW_IMAGES=3` + `tests/reviewImageCapContract.test.ts` 等号钉两侧。另修 **C7 空转判据**（旧断言的判据住在 scripts/ 永不进面 ⇒ 改为前缀回读 + src/ 正向对照）与补 **C8**（解析失败禁静默跳文件）。**M4** 根因改判并修复：不是厂商文案的"装在别的平台"，是 `@cloudflare/workerd-windows-64/bin/` 与 `@esbuild/win32-x64/` **只剩元数据、exe 被删**（两父目录 mtime 同为 09-27 03:38，全仓 `*.exe` 只剩 1 个）⇒ `npm pack` 取回两枚（只动 gitignore 的 node_modules，`git diff --quiet package-lock.json` 证与 HEAD 逐字节相同），`verify:functions` **本机首次跑绿**（98,401B、三入口齐备）。**M3** 档位登记补对账链；**M2** 按第十七轮"上限 40 + 前端分片"路线销账，**如实写明闭的不是原条目那句"n=200 语句 ≤3"**（bulk UPDATE 会丢 `{updated, failed[]}` 明细）。
- **P0（第十九轮开工先做这条）**
- [ ] **N3 部署（需老大一句话）**：本轮零线上动作。新后端（`errorCode` + 语义状态码）与新顾客端（分流 + 成功页 `localFallback` 横幅）**要各部署一次才生效**，顺序不敏感（前后端向后兼容已双向核：`client.ts` 读体不读 status、`sw.js` 绕过 /web /pub、`smoke` 只测成功路径）。按红线须先加载 `chaoshi-web-deploy` skill 取 checklist。部署前现网行为＝本轮修复前状态。
- [ ] **N2 `ServiceFormPage` 图片 ≤5 张，但服务端 `createSubmission` 不查条数** ⇒ 全链唯一 cap 在浏览器里，直接 POST /pub 可塞任意张（受 2MB/张 与 D1 语句体积间接约束）。要么服务端补条数 cap（则须加新 `errorCode` 并入册），要么在登记册把它定性为"仅前端展示约定"。
- [ ] **M5 图片 base64 与 D1 单语句 100KB 对齐（承十七轮，需老大点头）**：本轮新增事实 —— 范围不止"评价 + 付款截图"两处，`ServiceFormPage` 是第三个入口（原图 10MB 门槛 / 压缩后 2MB 上限，服务端同为 2MB）。定值前须先决定"图片走 base64 入 D1 还是走 R2 桶"。
- [ ] **N4 审计表加 `errorCode` 列**：`logSecurityEvent` 现在只有 ok/fail 二值，失败原因进了响应却没进审计。需一次 D1 迁移 ⇒ 新决策点，未擅动。
- [ ] **N1 两项既有红灯**：`verify:restore`（2 项）与 `check:backup-liveness` 需 `CF_D1_BACKUP_TOKEN`。**未设 `BACKUP_SKIP_OK` 绕过、未降格成"已核验"** —— 护栏拦下来就如实报拦在哪。
- [ ] **M7/M8 未变**：档位真实值需 CF 凭据；上限运行时自检待做。
- [ ] 需人不变项未变（`CF_D1_BACKUP_TOKEN` / `ORDER_WEBHOOK_URL` / K3 目视 / D2 49 单 / R2 桶 / order 41 / `adhoc-rename-order20.sql`）。
- [ ] 取证欠账：同栈（Pages Functions + D1）**未找到**"带机器可读错误码"的公开样板 ⇒ 本轮明写 NOT STATED，没把它当成"业界都这么做"的依据。

## 分卷目录

- 在册卷号：1–34。文件名一律 `07-next-steps.part<N>.md`（N 取上列区间内整数，不可跳号命名）。
- 本行由第十七轮体量收口压缩：原先逐行列举 33 行占主卷约 1.2KB，而 `handoff.py split` 自己就建议「人工精简分卷目录行」。
- 新拆卷时 `split` 会往本节追加行；追加后请顺手并回上面的区间描述，别让主卷再涨回 4KB 以上。
