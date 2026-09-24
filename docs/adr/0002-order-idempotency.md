# ADR 0002: 下单幂等用「部分唯一索引 + 内容指纹」双层

- 状态：已采纳（2026-09-24 对标第二轮 A1）
- 实测背景：弱网重试/双击会**同时产生两张单并双扣库存**。库存是 09-24 当天上线的，
  所以这个缺陷的代价从"多一张废单"升级为"凭空吃掉可售库存"。

## 对标结论（先纠一处以讹传讹）
- litemall **没有**幂等：`litemall_order` 只有主键，`order_sn` 无唯一索引，靠 `@Transactional` 清购物车，并行点击照样两张单。
- Medusa：HTTP 层 `Idempotency-Key` + 表内 `UNIQUE(idempotency_key, id)`，CONFLICT → 409 并提示"可用同一把键重试"。
- Saleor：Django `UniqueConstraint(app_identifier, idempotency_key)` + `IntegrityError` → 专用异常；索引以 `CONCURRENTLY` 在线建。
- Vendure：结构性免疫——购物车本身就是一个 active Order 行，同会话复用，`orderPlacedAt` 只置一次。

## 决策
1. 键 = `房间号@requestId#fnv1a(载荷指纹)`，落在 `orders.idempotencyKey`（新增 TEXT 列）。
2. **部分唯一索引** `WHERE idempotencyKey IS NOT NULL`：历史单与不带键的调用方为 NULL，完全不受约束。
3. 指纹折叠进键（刻意偏离 Medusa/Saleor 的纯键语义）：纯键下"改过备注再用旧键提交"会静默返回旧单、丢掉这次编辑。
4. 不带 requestId 的调用方走 90s 内容指纹兜底。这层不是假想需求：顾客端经 Service Worker 长缓存分发，
   新版 bundle 铺开前旧包会持续下单数小时到数天。
5. 去重判定在**扣库存之前**；唯一索引冲突（真并发）时回补本请求已占用的库存，再把既有单返回给调用方。

## 后果
- 幂等命中响应带 `deduplicated: true`，调用方可区分"新单"与"复用"。
- `requestId` 是**仅传输**字段，不进客户端/服务端存储白名单（该对称契约由 `tests/authWhitelist`、`shared.test` 锁定）。
