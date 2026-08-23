// 极简健康探活端点：GET /_health
// 用途：配合 Cloudflare Workers 日志面板 / 外部探活，快速判断「函数进程 + D1 绑定」是否可用。
// 不做敏感信息输出，仅返回状态。
export async function onRequestGet({ env }) {
  let db = 'unknown'
  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
    db = 'ok'
  } catch {
    db = 'error'
  }
  return new Response(JSON.stringify({ status: 'ok', db, ts: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
}