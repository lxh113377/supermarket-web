# 07-next-steps 分卷 116（第五十八轮续正文逐字迁出 · 主卷撞 4KB 上限）

> 迁出原因：主卷撞 4,096 **字节**上限，**迁出而非压缩措辞**（历史留痕不可改写）。
> 迁入时刻：2026-10-01（第五十九轮）。以下正文为第五十八轮续当轮原文，一字未改。

## 2026-10-01 — 第五十八轮续（R58-H1 落地：跨日采样 t1910 + 立线条件成立）

- 外层 58 轮报告已入库推送（外层 `4ee6ae5` / 内层 `fdd8839`）；白天功能面短名报告入库推送（外层 `4ee6ae5`，86 行）。
- R58-H1：预飞双端 200 → `collect:live-perf --run` 采 6/6（批次 t1910，fetchTime `2026-09-30T19:1xZ` = UTC 09-30 新日期；lh rc=1 产物有效系已知形态）。
  `report:live-perf`：批次组 9/12 完整，入统计 27/未采到 7，**立线条件已成立：admin/customer**；
  thresholds 已由并行会话于 03:22 写入（取值 = 历史批次中位数最大值 ×1.5，TBT ×2，CLS 取 0.1；方法见其 thresholdNote，待复验）。
- CI 回执：`ci-status` 120s 超时 + `gh run list` 无返回（GitHub 直连受限，与 58 轮 §9 同因）→ UNVERIFIED，不得写 CI 全绿；双仓 HEAD == 远端。
- 下一轮 P0（2026-10-01 04:30 实测改写；R58-H1 三项已关闭：thresholds 对方 03:22 已立线且 CI 绿；
CI 回执已回读 run36771213155/36771646776 双全绿；生产部署 CI deploy success 已自动发出 20:07Z）：
① **D1 线上迁移 promotions 表**——已验证无需执行：`migrate.mjs status --remote` 显示 10/10 DONE（`migrate-promotions.sql` 应用于 09-30 18:02），
远端实查 `promotions`/`order_discounts` 表在且默认档位 1 行；零待应用，故未跑 apply（最小生产接触）。
② 接手先判树归属（在途 5 文件：orders.js/backend.js/verify-backend.mjs/OrdersTab.tsx/types.ts，疑似 order_discounts 孤儿联删）；
③ 新性能批次到期再采（cadence 7 天，最新 t1910 = 09-30 UTC；github.io 本机 curl 000 系本机不通，非站点结论）。
