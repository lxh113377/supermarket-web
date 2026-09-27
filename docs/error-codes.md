# 错误语义登记册（唯一真相源，受 `npm run verify:errors` 双向对账）

> 本表由 `scripts/check-error-semantics.mjs` 校验三件事：
> ① `functions/` 里每个失败出口都必须走 `fail(errorCode, …)`，裸 `{ code: -1, message }` 判红；
> ② 本表的行与 `functions/lib/errors.js` 的 `ERRORS` **集合相等**（代码有表没有 ⇒ 红；表有代码没用 ⇒ 也判红），
>    且每行的 `kind` / HTTP 状态与登记表**逐项相等**（文档抄错一个数字就红）；
> ③ 前端镜像 `src/api/error-codes.ts` 与登记表码集合相等且 kind 逐项相等（两条构建链，同分片大小契约的先例）。
>
> **为什么要这张表（一手动因，本轮实测的丢单链）**：全仓 55 个失败出口共用一个 `code: -1`，
> HTTP 状态恒 200。`src/db/orders.ts` 的 catch 因此**无法区分**「服务端明确不收这单」与「请求根本没送到」，
> 一律 `addLocalOrder()` 本地兜底，再跳 `OrderSuccessPage` —— 而那个组件从不读 `localFallback`。
> 结果：**库存不足的订单在顾客屏幕上显示「下单成功！请完成支付」**，商家侧查不到这张单，顾客的钱没有对应物。
>
> `kind` 是唯一决定调用方动作的字段，取值固定 5 类：
> `input`（改输入才对）/ `state`（资源状态不允许，改数量、换商品、刷新后重试才对）/
> `auth`（重新登录或换密钥才对）/ `quota`（等一会儿原样重发才对）/
> `platform`（平台自己不对劲 —— **服务端失败里唯一允许调用方先把用户意图暂住本地**的一类）。
> 另有一类不在码表里：`transport`（fetch 抛错 / 超时 / 响应里没有 errorCode）。
> 前端 `FALLBACK_SAFE` = `{platform, transport}`，把 transport 放进去是刻意的保守方向：
> 顾客端（GitHub Pages）与后端（Pages Functions）分两次部署，窗口期内新前端会打到不带码的旧后端，
> 此时若判成"业务拒绝"，等于把一次"少一份本地暂存"的改动变成现网下单报错。

## 码表

| errorCode | kind | HTTP | retryable | 触发条件 | 调用方该做什么 |
|---|---|---|---|---|---|
| invalid_json | input | 400 | false | 请求体不是合法 JSON | 修请求体；不重发 |
| invalid_params | input | 400 | false | 必填参数缺失或取值非法（含 status 不在状态机内） | 修参数；不重发 |
| missing_order_id | input | 400 | false | 未传 orderId / 订单号 | 补字段 |
| missing_product_id | input | 400 | false | 未传 productId | 补字段 |
| missing_product_ids | input | 400 | false | 批量删除未传 productIds，或全是空串 | 补字段 |
| missing_product_order | input | 400 | false | 评价未挂到商品 productOrder | 补字段 |
| missing_items | input | 400 | false | 批量更新未传 items 数组 | 补字段 |
| missing_review_id | input | 400 | false | 删除评价未传 reviewId | 补字段 |
| missing_submission_id | input | 400 | false | 服务提交类操作未传 submissionId | 补字段 |
| missing_service_info | input | 400 | false | 服务提交缺 serviceId/serviceName | 补字段 |
| no_update_fields | input | 400 | false | 更新请求经白名单过滤后一个字段都不剩 | 至少改一个允许字段 |
| invalid_order_payload | input | 400 | false | 缺 roomNumber 或 items 为空 | 回购物车补齐 |
| invalid_quantity | input | 400 | false | 数量不是正整数（负数/小数/缺失） | 改数量 |
| invalid_text | input | 400 | false | UGC 文本过空/超长/含非法字符 | 改内容 |
| invalid_image | input | 400 | false | 图片 scheme 不在白名单（非 data:image/https） | 换图重传 |
| too_many_images | input | 400 | false | 评价图片多于 3 张 | 删到 3 张内 |
| image_too_large | input | 413 | false | 单张图片超 D1 单语句体积预算（`MAX_STATEMENT_PAYLOAD_CHARS` = 90,000 字符；第三十七轮按实测把 800KB/2MB 的假上限收敛成这一把尺） | 压小图片或减少张数 |
| payload_too_large | input | 413 | false | 整条记录（含全部图片）序列化后超单语句预算——一条 INSERT = 一行 = 一份预算 | 减少张数或压小图片 |
| quantity_exceeds_limit | input | 400 | false | 单行数量超产品上界 99（继承详情页在册硬顶；对标 `saleor/saleor` 站点默认 50、`medusajs/medusa` 只校库存） | 减少数量或拆成多单 |
| batch_too_large | input | 400 | false | 批量条目数超该批预算（更新 40 / 删除 200，两者不同因） | 按上限分片 |
| invalid_action | input | 400 | false | action 名不存在 | 修调用方；这是契约错不是运行错 |
| product_not_found | state | 404 | false | 商品行不存在（下单引用了已删商品，或更新命中空集） | 刷新商品列表后重下 |
| order_not_found | state | 404 | false | 订单行不存在 | 核对订单号 |
| submission_not_found | state | 404 | false | 服务提交不存在或已被处理掉 | 刷新列表 |
| product_disabled | state | 409 | false | 商品已下架 | 从购物车移除该商品 |
| stock_insufficient | state | 409 | false | 守卫式扣减有任一条 0 变更（库存不足） | 减数量或去掉该项后重下 —— **禁止静默本地兜底** |
| invalid_transition | state | 409 | false | 状态机不允许的迁移（如 completed → paid） | 刷新后按当前状态操作 |
| concurrent_update | state | 409 | false | 乐观锁抢占失败（有人先改过同一单） | 重新读取后再操作 |
| auth_failed | auth | 401 | false | 未带密钥或密钥不匹配任何档位 | 回登录页输密钥 |
| readonly_denied | auth | 403 | false | 只读密钥执行了未登记为可读的 action（默认拒绝方向） | 换写权限密钥 |
| action_not_public | auth | 403 | false | 走 /pub 请求了不在 PUBLIC_ACTIONS 的 action | 改走 /web 带密钥 |
| rate_limited | quota | 429 | true | KV/DB 限流桶达上限（登录 / 公开写 / aiChat / aiAdvice） | 按 Retry-After 等待后**原样重发**（幂等键不换） |
| db_unbound | platform | 500 | true | 部署没绑 D1（env.DB 缺失） | 调用方可暂住本地；同时要能报给运维 |
| internal_error | platform | 500 | true | 未捕获异常，或 fail() 收到未登记码（降级兜底） | 调用方可暂住本地；重试或人工跟进 |
| order_create_failed | platform | 500 | true | 订单落库抛错（非幂等冲突分支） | **本轮唯一保留本地兜底**的下单失败出口 |

## 不在这张表里的东西（口径边界）

- **HTTP 状态只在 `functions/web.js` / `functions/pub.js` 一处落地**（`apiResponse`）。
  业务层只返回信封，不碰 status —— 否则同一个码会在两处映射、必然漂移。
- **`code` 字段永远是 `-1`**（失败）/ `0`（成功）。这是兼容性红线，不是设计偏好：
  Service Worker 长缓存里的旧顾客端用 `code !== 0` 判失败，把 `code` 改成 4xx 数字
  会让旧包把「失败」读成「另一种成功」。故新语义**只加字段不改旧字段**。
  本条由判据 E8 机器守住（改 `fail()` 的 code 立即红）。
- **禁止任何调用方拿 `message` 做分支判断**。Saleor 的原文口径是
  "the returned message is only meant for debugging and is not suitable for display to your customers.
  Please use the `code` field"；本项目暂未做到"前端按 code 自拟文案"（单团队、无 i18n 需求），
  `message` 仍是服务端给的中文展示串 —— 但**分流键必须是 `kind`/`errorCode`**，
  这条边界由 E5 在下单链路上钉死（改文案不该改变是否兜底）。
- 档位/上限类事实不在本表，见 `docs/limit-provenance.md`；环境变量见 `docs/env-vars.md`。
