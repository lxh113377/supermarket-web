// 公开 API 端点：/pub  (POST { action, payload })
import { handlePublic, resolveCorsHeaders } from './lib/backend.js'

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: resolveCorsHeaders(request, {}) })
}

export async function onRequestPost({ request, env, context }) {
  const cors = resolveCorsHeaders(request, env)
  let body
  try {
    body = await request.json()
  } catch (e) {
    console.error('[/pub] 请求体 JSON 解析失败:', e)
    return new Response(JSON.stringify({ code: -1, message: '无效的 JSON 请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }
  const { action, payload } = body
  const holdOpen = typeof context?.waitUntil === 'function' ? (p) => context.waitUntil(p) : null
  const result = await handlePublic(env, action, payload || {}, request, holdOpen)
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
