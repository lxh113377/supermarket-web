# ADR 0001: 订单履约状态机在服务端单点强制

- 状态：已采纳（2026-09-24 对标第一轮）
- 上下文：顾客付完钱看不到进度、商家发货没地方标——这是本项目与一切成熟商城的分水岭（对标 litemall 订单域）。

## 决策
1. 5 态：pending → paid → delivering → completed，任意未完成态可 cancelled；cancelled 可回 pending（误取消恢复）。
2. 迁移合法性只在 `functions/lib/actions/orders.js` 的 `ORDER_TRANSITIONS` 单点强制，前端不复制第二份规则。
3. `status` 列是 TEXT 无 CHECK 约束 → 扩态**零 D1 迁移**（对比：加 CHECK 要建新表搬数据）。
4. 写状态带 `AND status = 读到的旧值`（乐观锁，对标 litemall `updateWithOptimisticLocker`）：
   两个管理员同时操作同一单只有一个能改成功，另一个收到"请刷新后重试"。
5. 取消/删除进行中单必须回补库存；误取消恢复要重新占用，占用失败则整笔拒绝且状态不动。

## 后果
- 管理端下拉只呈现合法迁移（以服务端为准），误操作被服务端拒绝并内联提示。
- 运营若要求"越过状态机改判"（如线下退款直接 completed），本 ADR 明确拒绝：那需要独立售后单模型，已登记待办（报告 C7）。
