# API 契约（人读版，由脚本生成）

> ⚠️ 本文件由 `npm run docs:api` 从 `docs/api-contract.json` 渲染，**不要手改**。
> 机器真相源：`scripts/api-contract.mjs`（源码解析生成）；漂移检查：`npm run verify:contract`（CI 阻断）。
> 生成时间：2026-09-24 ｜ 契约版本：1 ｜ 源：functions/lib/backend.js（由 scripts/api-contract.mjs --write 生成，请勿手改）

## 端点与策略

- **adminWriteActions**：["createProduct","updateProduct","deleteProduct","batchUpdateProducts","batchDeleteProducts","createOrder","recalculateOrders","addReview","addPublicReview","seedReviews","deleteOrder","updateOrderStatus","deleteReview","createSubmission","updateSubmissionStatus","deleteSubmission"]
- **publicWhitelist**：["createOrder","getReviews","createSubmission","addPublicReview","getPublicProducts","getPublicCategories","aiChat","getOrderStatus"]
- **publicRateLimitedWrite**：["createOrder","createSubmission","addPublicReview"]

## `/web` — 管理端（31 个 action）

鉴权：required（ADMIN_KEY / ADMIN_READONLY_KEY，只读密钥受 ADMIN_WRITE_ACTIONS 拦截）

| action | 读写 | 说明 |
|---|---|---|
| `login` | 读 |  |
| `verifyKey` | 读 |  |
| `getProducts` | 读 |  |
| `createProduct` | 写 |  |
| `updateProduct` | 写 |  |
| `deleteProduct` | 写 |  |
| `batchUpdateProducts` | 写 |  |
| `batchDeleteProducts` | 写 |  |
| `deleteOrder` | 写 |  |
| `updateOrderStatus` | 写 | 5 态状态机 + 乐观锁（UPDATE 带 `AND status = 读到的旧值`），并发迁移只有一个胜出 |
| `createOrder` | 写 | 幂等：带 `requestId` 走 `房间号@requestId#载荷指纹` 唯一索引；不带则 90s 内容指纹兜底。命中返回 `deduplicated: true` 且不动库存 |
| `recalculateOrders` | 写 |  |
| `stalePendingReport` | 读 | 只读盘点超时 pending 单（线下确认制，不自动砍单） |
| `getOrders` | 读 |  |
| `getOrder` | 读 |  |
| `getPublicProducts` | 读 |  |
| `getPublicCategories` | 读 |  |
| `getAllReviews` | 读 |  |
| `getReviews` | 读 |  |
| `getOrderStatus` | 读 | 顾客侧进度查询，免密钥，只回 status/updatedAt |
| `addPublicReview` | 写 |  |
| `addReview` | 写 |  |
| `deleteReview` | 写 |  |
| `seedReviews` | 写 |  |
| `createSubmission` | 写 |  |
| `getSubmissions` | 读 |  |
| `getSubmissionImages` | 读 |  |
| `updateSubmissionStatus` | 写 |  |
| `deleteSubmission` | 写 |  |
| `aiAdvice` | 读 |  |
| `getDashboardStats` | 读 |  |

## `/pub` — 公开端（8 个 action）

鉴权：none（公开接口，受 PUBLIC_ACTIONS 白名单约束）

| action | 读写 | 说明 |
|---|---|---|
| `getPublicProducts` | 读 |  |
| `getPublicCategories` | 读 |  |
| `createOrder` | 写 | 幂等：带 `requestId` 走 `房间号@requestId#载荷指纹` 唯一索引；不带则 90s 内容指纹兜底。命中返回 `deduplicated: true` 且不动库存 |
| `getReviews` | 读 |  |
| `getOrderStatus` | 读 | 顾客侧进度查询，免密钥，只回 status/updatedAt |
| `addPublicReview` | 写 |  |
| `createSubmission` | 写 |  |
| `aiChat` | 读 |  |

## 调用形态

两个端点同为 `POST`，请求体 `{ action, payload, adminKey? }`（`/web` 需 `adminKey`），
响应统一 `{ code, data?, message? }`，`code: 0` 为成功。金额一律服务端按库内价格重算，
客户端提交的金额不参与计算（防篡改）。

## 相关文档

- 架构与不变式：`docs/ARCHITECTURE.md`
- 决策记录（为什么这样设计）：`docs/adr/`
- 数据库迁移与账目：`db/` + `npm run migrate status`
