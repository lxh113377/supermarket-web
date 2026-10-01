// 管理 API 端点：/web  (POST { action, adminKey, payload })
import { logError, traceIdOf } from './lib/logger.js'
import { handleAdmin, resolveCorsHeaders } from './lib/backend.js'
import { apiResponse, fail } from './lib/errors.js'

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: resolveCorsHeaders(request, {}) })
}

export async function onRequestPost({ request, env, context }) {
  const cors = resolveCorsHeaders(request, env)
  let body
  try {
    body = await request.json()
  } catch (e) {
    logError('web', '请求体 JSON 解析失败', { trace: traceIdOf(request), err: e })
    return apiResponse(fail('invalid_json', '无效的 JSON 请求体'), cors)
  }
  const { action, adminKey, payload } = body
  // 绑定成独立函数再传下去：直接传 context.waitUntil 引用会在 Worker 里触发 Illegal invocation
  const holdOpen = typeof context?.waitUntil === 'function' ? (p) => context.waitUntil(p) : null
  const result = await handleAdmin(env, action, adminKey, payload || {}, request, holdOpen)
  return apiResponse(result, cors)
}
