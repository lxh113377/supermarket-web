// 管理 API 端点：/web  (POST { action, adminKey, payload })
import { handleAdmin, resolveCorsHeaders } from './lib/backend.js'

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: resolveCorsHeaders(request, {}) })
}

export async function onRequestPost({ request, env }) {
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
  const result = await handleAdmin(env, action, adminKey, payload || {}, request)
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
