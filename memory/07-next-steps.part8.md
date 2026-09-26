# 07-next-steps.part8.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **B1 覆盖率口径纠偏**：钉死 `include:['src/**']` 后真实值 **19.68%**（此前 43.72% 只算"被测试加载的文件"，可靠新增未测文件静默维持）；阈值棘轮 19.5/18/17.5/21，只升不降。
- **B2 首屏 77.9→86.4KB 归因**：`react-vendor` 66.0KB gz 占首屏 **76%**（react 19.3 + vite 8.3 抬基线），无可削业务代码 → 预算按实测 ×1.10 重设 95KB + 门禁打印首屏构成 top3（**下次一跳直接知道谁吃的**）。
- 提交：`59a4eab`（29 文件）+ `73e83a8`（migrate 工具自修）。门禁终态：lint 0/0（140 文件）｜tsc 0 错｜vitest **182/182**（29 文件）｜verify-backend **101/101**｜契约 **44**｜schema 漂移 **16/16**｜e2e **8/8**｜体积 **3/3**。
- ⚠️ **本轮踩到并修掉的两个工具脚枪**（下次写同类工具必须前置）：① `baseline` 无脑回记会把**未执行**的迁移一起吞掉（症状：apply 显示 0 待应用、列永远不建）→ 现逐个校验对象是否真在库里；② `--yes` 判断必须**先于** TTY 检查，否则自动化环境永远被拒。
- ⚠️ **驳回两条自动化调研主张**（子代理初稿，逐文件实测不成立）：「workflow 未锁 SHA」（实际 15 处全锁）、「dify.js baseUrl 来自用户输入可外发密钥」（实际只来自服务端 env）。**自动化产出进结论前必须抽验数据流。**
- **P0（下轮开工项）**：B4 页面层覆盖率 19.68% → ≥30%（按 `tests/orderFlow.test.tsx` 的 RTL 模式补 `OrderQueryPage`/`CartPage`/`PaymentPage`，每轮抬阈值）；B5 `stalePendingReport` 接 `OrdersTab`（内联展开，禁弹窗）。
- **P1**：C2 SQL 计数回归门禁（`makeD1` 里计 `prepare()` 次数 + 基线 JSON，约 40 行无新依赖，D1 读配额是真约束）；C1 license 门禁（本项目 MIT，需拦 GPL 传染）。
- **P2/阻塞**：C5 备份激活仍需用户配 `CF_D1_BACKUP_TOKEN`（**未激活期间 `migrate apply --remote` 前必须手工全量导出**，本轮已照此执行）；C3 超时自动释放阻塞于 C4 真实支付资质；C6 echarts 6 升级评估（已缓解，可从容）。

## 2026-09-24 — 用户裁决轮（库存 + 订单查询 + D1 备份 + dependabot）

- **库存防超卖（对标 C1）**：`products.stock`（-1=不限售）；下单守卫式占用（条件 UPDATE 防并发，失败同请求补偿回补）、取消/删除进行中单回补、误取消恢复重新占用；管理端内联编辑库存字段 + 缺货/低库存角标；公开接口下发 stock。生产迁移 `db/migrate-stock.sql` 已 `--remote` 执行（PRAGMA 实证列存在，全量备份先落 `_backup/d1/supermarket-2026-09-24.sql` 1.44MB）。
- **订单查询页 `#/order-query`（对标 litemall 订单跟踪，方案 A）**：5 步进度时间线 + 取消态提示 + pending 去支付按钮；成功页展示/复制订单号 + 查询入口（`sm_query_order` 跨导航兜底）。

## 分卷目录
- **卷1** `07-next-steps.part7.md` — 07-next-steps 分卷（R199 自动拆卷）

