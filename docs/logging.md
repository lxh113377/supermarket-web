# 日志出口登记册（唯一真相源，受 `npm run verify:logs` 双向对账）

> 本表由 `scripts/check-logging.mjs` 校验四件事，全部按**代码现算**取分母，本文件不写死任何计数：
> ① **L1 裸 console**：`functions/` 里每一处 `console.*` 位点都必须在下方豁免表内（漏登=红，表上有码里没=也判红）；
> ② **L2 mod 双向**：代码里 `logError/logWarn` 的首参（mod 名）与本表 mod 登记**集合相等**；
> ③ **L3 整包禁入**：日志字段里不得出现 `{ payload }` / `{ body }` / `{ request }` 这类整对象 —— 订单载荷含
>    `roomNumber`/`items`/`paymentScreenshot`，一次"顺手全打出来"就等于把登记册的豁免作废；
> ④ **L4 分母非零**：`functions/` 采集面为 0 个文件 / 0 处 log 位点时直接判红，防"读空 ⇒ 全绿"；
> ⑤ **L5 PII 双向**：`functions/lib/logger.js` 的 `PII_KEYS` ⇄ `docs/pii-inventory.md` 里类别为
>    「个人数据 / 凭证」的每个列名 + 本文件补充册，两个方向都差一个就红。
>
> **为什么要这张表（一手动因，本轮实测）**：`functions/` 原有 20 处失败出口写成
> `console.error('[admin]', action, e)` 这种给人看的形态 —— 按 level 筛不了、按 action 聚合不了、
> traceId 无处附着；而 `console.error('[cache] put failed:', key, e)` 会把 `rate:login:<ip>` 整串打出去，
> 登记册 `bucket` 行自己写着「这列就是明文 IP」。外审对标里 mall / medusa / erpnext / saleor 四个同类
> 都有一等公民的日志层，本仓挂了六轮的「线上异常无据可查」缺的就是这一处出口。
>
> 日志形状（`functions/lib/logger.js`）：一行一条 JSON，固定头 `ts` / `level` / `mod` / `msg`，
> 可选 `trace`（复用边缘节点 `cf-ray`），其余为调用方字段；PII 键的**值**换成 `[redacted]`、
> **键保留**（让运维知道有该字段被拦而不是"这次恰好没有"）；字符串里的 IPv4/IPv6 形状一并洗成 `[ip]`。

## 裸 console 豁免表

| 文件 | 理由 |
|---|---|
| functions/lib/logger.js | 本文件是 `functions/` 唯一的日志出口，`emit()` 按 level 分流到 error/warn 两档；豁免只给这一处，再由 L1 的双向差集钉住"不许有第二处"（实测：`grep -rn "console\." functions/ --include="*.js" \| grep -v lib/logger.js` 输出 0 行）。 |

## mod 登记册

| mod | 出处 | 记什么 |
|---|---|---|
| web | functions/web.js | `/web` 请求体不是合法 JSON（顾客/后台拿到 400 的前一刻，服务端侧唯一的痕迹） |
| pub | functions/pub.js, functions/lib/backend.js | `/pub` 请求体解析失败 + 公开端 action 未捕获异常 |
| admin | functions/lib/backend.js | 管理端 action 未捕获异常（带 action 名 + trace） |
| errors | functions/lib/errors.js | `fail()` 收到未登记的 errorCode —— 登记册脱节的现场信号 |
| cache | functions/lib/cache.js | KV 读失败之外的写/失效失败（降级为直查 DB，不影响正确性，但会拉高 D1 读） |
| rate | functions/lib/security.js | KV 限流故障回退 D1（回退本身是设计行为，记的是"KV 又坏了"） |
| audit | functions/lib/security.js | `security_events` 写入/清理失败（审计面丢事件 = 事故，不是噪声） |
| notify | functions/lib/notify.js | 新订单 webhook 未送达（warn）/ 调度异常被吞（error） |
| dify | functions/lib/dify.js | AI 调用失败与熔断前异常（只记 scene 与错误名，Key 从不进 fields） |
| ai_trace | functions/lib/ai_trace.js | `ai_calls` 埋点写入/统计失败（埋点丢了不影响主流程，但会失真） |
| aiAdvice | functions/lib/actions/ai.js | 管理端 AI 建议生成失败 |
| aiChat | functions/lib/actions/ai.js | 顾客端 AI 导购对话失败 |
| orders | functions/lib/actions/orders.js | `createOrder` 落库失败且库存已回补（丢单链路的最后一条服务端证据） |

## PII 补充册（流经代码、但从未入库的键）

登记册只管 D1 列；下面 4 个键不是列，但会以请求体/表单键的形式经过日志出口，故在此登记后进入 `PII_KEYS`。

| 键 | 理由 |
|---|---|
| adminKey | `/web` 请求体的鉴权字段（`functions/web.js` 解构 `body.adminKey`），打进日志等于把后台口令写进日志面 |
| password | 与 adminKey 同族的口令字段名；`grep -rn password functions/ src/` 实测命中 2 个文件，本仓当前无口令登录 ⇒ 属预防性登记，防未来新增登录入口时整包落日志 |
| phone | `submissions.formData` 的顾客自填键（登记册 `formData` 行写明"键名可能出现 phone/姓名"），整包 redact 挡不住按键落日志的写法 |
| address | 送货语义的第二个地址字段名（登记册 `roomNumber` 行：楼栋+房间号等同住址），与 phone 同族按最坏情况登记 |

## 字段命名约定（不做成判据，写在这里供 review）

- 错误对象一律放 `err`（`scrubValue` 认 `Error` 实例并取 `name: message` 截 300 字），不要散装成第三个 `console.error` 参数。
- 关联用 `trace`，不是 `requestId`/`reqId` —— 只有一个名字才聚合得起来。
- 单号用 `orderId`：它按登记册属「派生」（顺键可 JOIN 到 `roomNumber`），但排障离不开它，
  且 events.js 的队列白名单同样放行 `orderId`，两处口径一致。
