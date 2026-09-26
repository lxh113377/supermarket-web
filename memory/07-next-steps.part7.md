# 07-next-steps.part7.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **D1 每日备份**：`d1-backup.yml` cron 04:00 北京；**用户待办：配仓库 secret `CF_D1_BACKUP_TOKEN`（Cloudflare API Token，D1:Read）**——缺 token 时该 workflow 显式 warning 跳过（不假绿）。
- **dependabot 8 PR**：5 minor（#12/#11/#10/#9/#5）本地统一解析一次合并（npm 实际落 oxlint 1.85.0 / wrangler 4.137.0 / react 19.3.0 / vite 8.3.0 / autoprefixer 10.6.1，组内更高 minor 属允许漂移）；3 major 关闭附理由（github-script v9 = 实测坑，checkout/setup-node 留专项轮）。
- **根因修复**：ci.yml `concurrency.group` 改按 ref 分组——原固定组名让 PR run 与 main run 互相取消，dependabot 批量合并 5/5 卡 unstable（部署 skill §2.1 坑#1 的治本）。
- 线上实测：农夫山泉临时 stock=1 → 数量2 被拒（库存不足）→ 数量1 成功 → 取消 → 还原 -1；测试单全部删除；浏览器级查询页正/负例通过（无 CSP 报错）。
- 门禁终态：lint 0/0、tsc 0 错、vitest 176/176、verify-backend **84/84**、e2e **8/8**、契约 43、体积 3/3。

## 2026-09-24 — GitHub 开源对标轮（履约闭环 + 门禁加深）

- 对标报告与改进清单：外层 `deliverables/GitHub开源项目对标分析报告-2026-09-24.md`（对标 litemall/Medusa/Saleor/Vercel Commerce，七维 + P0/P1/P2）。
- **已落地（本轮）**：① 订单 5 态状态机（服务端 `ORDER_TRANSITIONS` 强制，TEXT 列零迁移）+ 管理端合法迁移下拉；② 顾客侧 `/pub getOrderStatus` + 支付页进度（**顺带修复**：旧轮询误用 `adminCall('getOrder')`，顾客端无密钥必然失败）；③ e2e 4→7 用例 + `vite.config.e2e.js` 空 envDir 修复"本机 e2e 必挂"（本机 .env 致云端模式）；④ CI 新增 `check:cycles`/`verify:contract` 阻断步 + v8 覆盖率 artifact（本机覆盖率可用，CHANGELOG 旧"worker 崩溃"待办作废）；⑤ `docs/ARCHITECTURE.md` + README 架构入口。
- 门禁终态：lint 0/0 ｜ tsc 0 错 ｜ vitest **176/176**（28 文件）｜ verify:backend **66/66** ｜ 契约 /web 30 + /pub 8（43 断言）｜ e2e 7/7 ｜ build+体积 3/3。
- **P0（本轮唯一可执行下一步）**：~~推送后线上验证~~ ✅ **已完成（2026-09-24 线上实测）**：CI run 35963451061 success（head 5db9efc）+ dispatch + github.io run 35963461764 success；①28 商品 ②2 分类 ④错误密钥被拒 ⑥CORS 精确回显 ⑦gh.io 200 且 sw 指纹 `sm-v1790230428269`（CI 新构建）；**订单状态机端到端**：/pub createOrder(pending) → /pub getOrderStatus(pending) → /web updateOrderStatus(paid) → getOrderStatus(paid) → 非法 paid→completed 被拒 → deleteOrder 清理 → getOrderStatus「订单不存在」，全链路生产验证通过。
- **P1 待办（对标报告 P2 列，各需前置条件）**：C1 库存（需生产 D1 `ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT -1` + 扣减链路，单独部署窗口）；C2 R2 直传；C5 D1 定时备份。

## 分卷目录
- **卷1** `07-next-steps.part6.md` — 07-next-steps 分卷（R199 自动拆卷）

