# 07 分卷 34（第十八轮体量收口：第十七轮小节整段搬入，逐字保留）

## 2026-09-27 — 对标第十七轮（数值上限溯源：同一个 200，两种命运）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十七轮-2026-09-27.md`（§7 已重建第十六轮结论，那轮的报告欠账一并清掉）。回滚锚 `5529e29`；备份 `_backup/pre-round17-2026-09-27/pre-round17.bundle`。

- **一句话**：`functions/` 40 个"会砍东西"的数值上限零溯源 ⇒ 新门禁 `verify:limits`（C1~C7：登记册双向对账 + 值 <= 所引平台事实 + TODO 即红）。**实测抓出**：`batchUpdateProducts` 与 `batchDeleteProducts` 同挂 200，前者语句数 1+n（n=200 ⇒ 201 > 免费档 50）、后者常数（200 参数 < SQLite 999）⇒ `BATCH_UPDATE_MAX` 改 **40**（由 50 推导）、前端加 `BATCH_UPDATE_CHUNK=40` 分片、两侧等值由 `tests/batchChunkContract.test.js` 钉住。另发现图片 base64 上限 600 KB > D1 单语句 100 KB ⇒ **应用层校验形同虚设**（G3，只判红不擅改）。MA6 夹具尾账已清。
- **P0（第十八轮开工先做这条）**
- [ ] **M5 图片 base64 上限与 D1 单语句 100 KB 对齐（需老大点头）**：先定"截图/评价图到底走 base64 入 D1 还是走 R2 对象存储桶"，再定收紧值；须同时核**现存带图订单**能否通过新校验（否则是把历史单判成脏数据）。
- [ ] **M6 把 `src/` 纳入上限普查面**：前端分页 pageSize、localStorage 配额、`src/data/*.ts` 里的展示条数目前无人管；登记册头部已明写取数面只到 `functions/**`，扩面时同步改那句声明（不许悄悄扩）。
- [ ] **M7 档位事实**：若实际是 Workers Paid，登记后 `BATCH_UPDATE_MAX` 可放大；但必须留"为什么是了这个数"，不许只改数字。
- [ ] **M4 修本机 workerd**（承十六轮）：`@cloudflare/workerd-windows-64/bin/` 空目录 ⇒ `verify:functions` 本机长期缺位，只在 CI 有牙。
- [ ] **M2 遗留观察**：`catalog report` 阻断后仍无新的定时跑，误报率无法判（承第十二轮）。
- [ ] 需人不变项未变（`CF_D1_BACKUP_TOKEN` / `ORDER_WEBHOOK_URL` / K3 目视 / D2 49 单 / R2 桶 / order 41 / `adhoc-rename-order20.sql`）。
- [ ] 取证欠账：Django/Rails"批次由驱动参数上限反推"两次取证未得（搜索无结果、文档页截断）⇒ 第十七轮报告只作思路参照；下一轮要引须重新取。
