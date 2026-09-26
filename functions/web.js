// 管理 API 端点：/web  (POST { action, adminKey, payload })
import { handleAdmin, resolveCorsHeaders } from './lib/backend.js'

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: resolveCorsHeaders(request, {}) })
}

export async function onRequestPost({ request, env, context }) {
  const cors = resolveCorsHeaders(request, env)
  let body
  try {
    body = await request.json()
  } catch (e) {
    console.error('[/web] 请求体 JSON 解析失败:', e)
    return new Response(JSON.stringify({ code: -1, message: '无效的 JSON 请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }
  const { action, adminKey, payload } = body
  // 绑定成独立函数再传下去：直接传 context.waitUntil 引用会在 Worker 里触发 Illegal invocation
  const holdOpen = typeof context?.waitUntil === 'function' ? (p) => context.waitUntil(p) : null
  const result = await handleAdmin(env, action, adminKey, payload || {}, request, holdOpen)
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
