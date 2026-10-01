// 管理 API 端点：/web  (POST { action, adminKey, payload })
import { logError, traceIdOf } from './lib/logger.js'
import { handleAdmin, resolveCorsHeaders } from './lib/backend.js'
import { apiResponse, fail, withTrace } from './lib/errors.js'
import { scheduleSink } from './lib/event_sink.js'

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: resolveCorsHeaders(request, {}) })
}

export async function onRequestPost({ request, env, context }) {
  const cors = resolveCorsHeaders(request, env)
  const trace = traceIdOf(request)
  let body
  try {
    body = await request.json()
  } catch (e) {
    logError('web', '请求体 JSON 解析失败', { trace, err: e })
    return apiResponse(withTrace(fail('invalid_json', '无效的 JSON 请求体'), trace), cors)
  }
  const { action, adminKey, payload } = body
  // 绑定成独立函数再传下去：直接传 context.waitUntil 引用会在 Worker 里触发 Illegal invocation
  const holdOpen = typeof context?.waitUntil === 'function' ? (p) => context.waitUntil(p) : null
  const result = await handleAdmin(env, action, adminKey, payload || {}, request, holdOpen)
  // M-59-1：第 3 步消费者 —— 本批 emit 的事件落 event_log（响应已定，不增加延迟）
  scheduleSink(env, holdOpen)
  return apiResponse(withTrace(result, trace), cors)
}
