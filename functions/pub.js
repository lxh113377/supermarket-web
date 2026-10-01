// 公开 API 端点：/pub  (POST { action, payload })
import { logError, traceIdOf } from './lib/logger.js'
import { handlePublic, resolveCorsHeaders } from './lib/backend.js'
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
    logError('pub', '请求体 JSON 解析失败', { trace: traceIdOf(request), err: e })
    return apiResponse(fail('invalid_json', '无效的 JSON 请求体'), cors)
  }
  const { action, payload } = body
  const holdOpen = typeof context?.waitUntil === 'function' ? (p) => context.waitUntil(p) : null
  const result = await handlePublic(env, action, payload || {}, request, holdOpen)
  return apiResponse(result, cors)
}
