# 07 分卷 175 —— 07-next-steps.part35.md 后半（第七十八轮 round-3 I-78-6 拆出，逐字未改）

> 建卷理由：part35 出生 5408B（现 4006B）仍违出生口径，整段迁出。前半仍在 `07-next-steps.part35.md`，其尾部「后半卷」节指回这里；字节恒等断言（head+tail===原文）在拆的当场跑过。

- **同时清掉第十七轮四条尾账**：**M6** `src/` 入上限普查面（40⇒63 项）—— 扩面当轮即抓出 ① `x.length>0`/`<1` 是**非空判断不是上限**（functions/ 里恰好零出现，一进 src/ 造 12 行假阳性 ⇒ 补 `EMPTY_TEST` 改机制，未调阈值未开豁免）② **评价配图 5-vs-3 不一致**：前端硬编码 5、屏上印「最多 5 张」、注释还声称"服务端 ≤5"，服务端一直是 >3 ⇒ 按屏上提示选到第 4 张整条被退回；收口 `MAX_REVIEW_IMAGES=3` + `tests/reviewImageCapContract.test.ts` 等号钉两侧。另修 **C7 空转判据**（旧断言的判据住在 scripts/ 永不进面 ⇒ 改为前缀回读 + src/ 正向对照）与补 **C8**（解析失败禁静默跳文件）。**M4** 根因改判并修复：不是厂商文案的"装在别的平台"，是 `@cloudflare/workerd-windows-64/bin/` 与 `@esbuild/win32-x64/` **只剩元数据、exe 被删**（两父目录 mtime 同为 09-27 03:38，全仓 `*.exe` 只剩 1 个）⇒ `npm pack` 取回两枚（只动 gitignore 的 node_modules，`git diff --quiet package-lock.json` 证与 HEAD 逐字节相同），`verify:functions` **本机首次跑绿**（98,401B、三入口齐备）。**M3** 档位登记补对账链；**M2** 按第十七轮"上限 40 + 前端分片"路线销账，**如实写明闭的不是原条目那句"n=200 语句 ≤3"**（bulk UPDATE 会丢 `{updated, failed[]}` 明细）。
- **P0（第十九轮开工先做这条）**
- [ ] **N3 部署（需老大一句话）**：本轮零线上动作。新后端（`errorCode` + 语义状态码）与新顾客端（分流 + 成功页 `localFallback` 横幅）**要各部署一次才生效**，顺序不敏感（前后端向后兼容已双向核：`client.ts` 读体不读 status、`sw.js` 绕过 /web /pub、`smoke` 只测成功路径）。按红线须先加载 `chaoshi-web-deploy` skill 取 checklist。部署前现网行为＝本轮修复前状态。

> 本卷按 4KB 上限拆分，后半段在 `07-next-steps.part44.md`（内容逐字未改，只做了整段搬移）。
