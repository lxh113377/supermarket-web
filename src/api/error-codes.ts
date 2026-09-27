// 前端侧错误码镜像（唯一消费者是"能不能静默兜底"这一个判断）
//
// 为什么是第二份：Pages Functions 与 Vite 前端是两条构建链，物理上不能共享模块
// （同 src/auth.ts 的 BATCH_UPDATE_CHUNK、src/utils/spec-options.ts 的口味分隔符先例）。
// 两侧一致性由 tests/errorCodeContract.test.ts 用**等号**钉住：码集合相等且 kind 逐项相等，
// 漂移不是报错而是"顾客端只认一半失败"，症状恰恰是本轮修掉的那个 —— 业务拒绝被当成网络故障。
//
// 与后端的兼容性约定：这里**故意不放 HTTP status**。状态码是传输层事实，前端从 res.status 读，
// 镜像一份只会多一个漂移点；本文件只承载"调用方该做什么"这一件业务事实。
import type { ApiResult } from '../types'

export const ERROR_KINDS = ['input', 'state', 'auth', 'quota', 'platform'] as const
export type ErrorKind = (typeof ERROR_KINDS)[number]

/** errorCode -> kind。与 functions/lib/errors.js 的 ERRORS 一一对应（契约测试判等）。 */
export const SERVER_ERROR_KIND: Record<string, ErrorKind> = {
  invalid_json: 'input',
  invalid_params: 'input',
  missing_order_id: 'input',
  missing_product_id: 'input',
  missing_product_ids: 'input',
  missing_product_order: 'input',
  missing_items: 'input',
  missing_review_id: 'input',
  missing_submission_id: 'input',
  missing_service_info: 'input',
  no_update_fields: 'input',
  invalid_order_payload: 'input',
  invalid_quantity: 'input',
  invalid_text: 'input',
  invalid_image: 'input',
  too_many_images: 'input',
  image_too_large: 'input',
  payload_too_large: 'input',
  quantity_exceeds_limit: 'input',
  batch_too_large: 'input',
  invalid_action: 'input',
  product_not_found: 'state',
  order_not_found: 'state',
  submission_not_found: 'state',
  product_disabled: 'state',
  stock_insufficient: 'state',
  invalid_transition: 'state',
  concurrent_update: 'state',
  auth_failed: 'auth',
  readonly_denied: 'auth',
  action_not_public: 'auth',
  rate_limited: 'quota',
  db_unbound: 'platform',
  internal_error: 'platform',
  order_create_failed: 'platform',
}

/**
 * 失败归类：`transport` = 请求根本没拿到结构化响应（fetch 抛错 / 超时 / 非 JSON / 旧后端未回 errorCode）。
 * 归到 transport 是**刻意的保守方向**：后端先于前端部署、或顾客端还是 Service Worker 缓存的旧包时，
 * 响应里没有 errorCode —— 此时若默认"业务拒绝"就会把一次正常的下单直接打断。
 * 不确定时不改变现有行为，只有**明确非 platform 的 kind** 才禁止静默兜底。
 */
export type FailureClass = ErrorKind | 'transport'

export function classifyFailure(res: Pick<ApiResult, 'errorCode' | 'kind'> | null | undefined): FailureClass {
  const kind = res?.kind
  if (kind && (ERROR_KINDS as readonly string[]).includes(kind)) return kind as ErrorKind
  // 有码无 kind（后端只发了 errorCode）：按码表反查，仍查不到才算传输故障
  const byCode = res?.errorCode ? SERVER_ERROR_KIND[res.errorCode] : undefined
  return byCode ?? 'transport'
}

/**
 * 允许把用户意图先暂住本地的两类：**平台自己不对劲**（platform）+ **根本没拿到结构化响应**（transport）。
 * transport 在内是刻意的保守方向，不是漏项：顾客端（GitHub Pages）与后端（Pages Functions）是
 * 两次独立部署，窗口期内新前端会打到还没带 errorCode 的旧后端；此时若判成"业务拒绝"，
 * 等于把一轮本来只是"少一次本地暂存"的改动变成现网下单报错。
 * 反过来 input/state/auth/quota 四类**一律禁兜底** —— 本轮那起丢单就发生在 state 上。
 */
const FALLBACK_SAFE: ReadonlySet<FailureClass> = new Set(['platform', 'transport'])

export function isFallbackSafe(res: Pick<ApiResult, 'errorCode' | 'kind'> | null | undefined): boolean {
  return FALLBACK_SAFE.has(classifyFailure(res))
}

/** 业务拒绝：服务端活着、且明确说了"这一单我不收"。必须让顾客看见原因。 */
export class OrderRejectedError extends Error {
  readonly errorCode: string
  readonly kind: ErrorKind

  constructor(errorCode: string, kind: ErrorKind, message: string) {
    super(message)
    this.name = 'OrderRejectedError'
    this.errorCode = errorCode
    this.kind = kind
  }
}
