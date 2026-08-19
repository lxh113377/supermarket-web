// 公开 API 端点：/pub  (POST { action, payload })
import { handlePublic } from './lib/backend.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}

export async function onRequestPost({ request, env }) {
  let body = {}
  try { body = await request.json() } catch {}
  const { action, payload } = body
  const result = await handlePublic(env, action, payload || {})
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
