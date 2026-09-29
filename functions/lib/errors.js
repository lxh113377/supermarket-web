// 错误语义登记表（唯一真相源，受 `npm run verify:errors` 双向对账）
//
// 一手动因（第十八轮实测的丢单链）：functions/ 里 54 个失败出口全部返回
// `{ code: -1, message: '<中文>' }`，HTTP 状态恒 200。调用方拿不到任何机器可读字段，
// 于是 `src/db/orders.ts` 的 catch 把**服务端业务拒绝**（库存不足 / 已下架 / 限流 / 认证失败）
// 与**传输故障**（fetch 抛错 / 超时）读成同一件事，一律 `addLocalOrder()` 本地兜底，
// 再跳 `OrderSuccessPage`（它此前完全不读 `localFallback`）——
// 顾客看到「下单成功！请完成支付」，商家那边根本没有这张单。
//
// 分类不是装饰：`kind` 决定调用方**该做什么**，其中 `platform` 是唯一允许"先把单暂住"的一类。
// 对标见第十八轮报告 §1（Stripe 的 type+code+decline_code 分层、Medusa 的 ApiError→status 表、
// Saleor 的 extensions.errorCodes、RFC 9457 要求按 `type` 而非 `detail` 分流）。
//
// 兼容性红线：`code: -1` 一个字都不改。顾客端要经 Service Worker 长缓存铺开，
// 旧 bundle 判定失败用的是 `code !== 0`；若把 code 换成非 -1 的数，旧客户端会把
// "失败"读成"成功"（0 才是唯一成功值），那才是真的把缺陷修成事故。新字段一律纯追加。

/** 失败大类 —— 决定调用方的处置动作，不是给人看的描述。 */
export const ERROR_KINDS = new Set(['input', 'state', 'auth', 'quota', 'platform'])

/**
 * 码表：errorCode -> { kind, status, retryable, message }
 * `status` 为 HTTP 状态；`retryable` 语义 =「同一载荷原样重发有没有可能成功」
 * （state 类改数量/换商品才可能成功，原样重发永远失败，故 false）。
 * 新增码必须同时在这里出现并被代码引用，否则 verify:errors 的 E2 双向对账判红。
 */
export const ERRORS = {
  // ── 协议 / 输入 ──────────────────────────────────────────────
  invalid_json: { kind: 'input', status: 400, retryable: false },
  invalid_params: { kind: 'input', status: 400, retryable: false },
  missing_order_id: { kind: 'input', status: 400, retryable: false },
  missing_product_id: { kind: 'input', status: 400, retryable: false },
  missing_product_ids: { kind: 'input', status: 400, retryable: false },
  missing_product_order: { kind: 'input', status: 400, retryable: false },
  missing_items: { kind: 'input', status: 400, retryable: false },
  missing_review_id: { kind: 'input', status: 400, retryable: false },
  missing_submission_id: { kind: 'input', status: 400, retryable: false },
  missing_service_info: { kind: 'input', status: 400, retryable: false },
  no_update_fields: { kind: 'input', status: 400, retryable: false },
  invalid_order_payload: { kind: 'input', status: 400, retryable: false },
  invalid_quantity: { kind: 'input', status: 400, retryable: false },
  invalid_text: { kind: 'input', status: 400, retryable: false },
  invalid_image: { kind: 'input', status: 400, retryable: false },
  too_many_images: { kind: 'input', status: 400, retryable: false },
  image_too_large: { kind: 'input', status: 413, retryable: false },
  payload_too_large: { kind: 'input', status: 413, retryable: false },
  quantity_exceeds_limit: { kind: 'input', status: 400, retryable: false },
  invalid_delta: { kind: 'input', status: 400, retryable: false },
  invalid_kind: { kind: 'input', status: 400, retryable: false },
  batch_too_large: { kind: 'input', status: 400, retryable: false },
  invalid_action: { kind: 'input', status: 400, retryable: false },

  // ── 资源状态（改输入才可能成功；原样重发必然同样失败）────────
  product_not_found: { kind: 'state', status: 404, retryable: false },
  order_not_found: { kind: 'state', status: 404, retryable: false },
  submission_not_found: { kind: 'state', status: 404, retryable: false },
  product_disabled: { kind: 'state', status: 409, retryable: false },
  stock_insufficient: { kind: 'state', status: 409, retryable: false },
  stock_untracked: { kind: 'state', status: 409, retryable: false },
  invalid_transition: { kind: 'state', status: 409, retryable: false },
  concurrent_update: { kind: 'state', status: 409, retryable: false },

  // ── 鉴权 / 授权（重登或换密钥才对，绝不该"先暂住"）───────────
  auth_failed: { kind: 'auth', status: 401, retryable: false },
  readonly_denied: { kind: 'auth', status: 403, retryable: false },
  action_not_public: { kind: 'auth', status: 403, retryable: false },

  // ── 配额（服务端活着并明确说了"慢点"，重试才对）──────────────
  rate_limited: { kind: 'quota', status: 429, retryable: true },

  // ── 平台自身（唯一允许调用方先行兜底、不丢用户意图的一类）────
  db_unbound: { kind: 'platform', status: 500, retryable: true },
  internal_error: { kind: 'platform', status: 500, retryable: true },
  order_create_failed: { kind: 'platform', status: 500, retryable: true },
}

/** 未知码的兜底：fail-closed 记成平台故障（可观测），并且 CI 的 E2 会让它不可达。 */
export const UNKNOWN_ERROR_CODE = 'internal_error'

/**
 * 构造失败响应。`code: -1` 恒定 —— 见文件头兼容性红线。
 * 调用方分流只需读 `kind`；细分原因读 `errorCode`；`message` 只用于展示，
 * **禁止**任何调用方拿 message 做分支判断（本轮判据 E5 把这条钉在下单链路上）。
 */
export function fail(errorCode, message, extra = {}) {
  let key = errorCode
  let meta = ERRORS[key]
  if (!meta) {
    // 未登记码降级成平台故障（500/platform），**不抛**：checkAuth / checkRate 的失败出口
    // 在 handleAdmin 的 try 之外，这里一抛就变成 Pages 未捕获异常（顾客拿到非 JSON 的 500 页），
    // 把"登记册脱节"这种可修的缺陷升级成"整条鉴权链不可用"。真防线在 CI 的 E2 双向对账。
    console.error('[errors] 未登记的 errorCode:', errorCode)
    key = UNKNOWN_ERROR_CODE
    meta = ERRORS[key]
  }
  return { code: -1, errorCode: key, kind: meta.kind, retryable: meta.retryable, message, ...extra }
}

/** 该失败对应的 HTTP 状态（未登记一律 500，不猜）。 */
export function httpStatusOf(errorCode) {
  const meta = errorCode ? ERRORS[errorCode] : null
  return meta ? meta.status : ERRORS[UNKNOWN_ERROR_CODE].status
}

/**
 * 429 带 Retry-After。MDN 的措辞是 "may be included"（建议、非强制），
 * 本项目仍把它做成硬要求：限流窗口在这里是**已知量**，不发等于让前端自己猜等多久。
 */
export function retryAfterSeconds(windowMs) {
  return String(Math.max(1, Math.ceil((Number(windowMs) || 0) / 1000)))
}

/**
 * HTTP 响应收口：状态码由 errorCode 决定，**不再一律 200**。
 * 判"成功"只看 `code === 0` 的旧客户端不受影响（成功仍是 200）；
 * 失败改成语义状态码，让 CDN / 监控 / 探活第一次能只看状态行就分清"平台坏了"和"顾客输入错了"。
 */
export function apiResponse(result, cors = {}) {
  const ok = !!(result && result.code === 0)
  const status = ok ? 200 : httpStatusOf(result && result.errorCode)
  const headers = { 'Content-Type': 'application/json', ...cors }
  if (!ok && status === 429) headers['Retry-After'] = retryAfterSeconds(result.retryAfterMs)
  return new Response(JSON.stringify(result), { status, headers })
}
