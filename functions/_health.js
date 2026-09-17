// 极简健康探活端点：GET /_health
// 用途：配合 Cloudflare Workers 日志面板 / 外部探活，快速判断「函数进程 + D1 绑定 + AI 后端配置态」是否可用。
// 不做敏感信息输出：AI 只暴露布尔与来源，绝不回显端点 URL 或密钥（脱敏由 tests/healthContract.test.js 钉住）。
// 双向迭代 R5（2026-09-18）：新增 ai / deploy 字段，用于发现「改了 Pages secret 但忘记重新部署」与「AI 静默降级为规则版」。
export async function onRequestGet({ env }) {
  let db = 'unknown'
  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
    db = 'ok'
  } catch {
    db = 'error'
  }

  const configured = Boolean(env.DIFY_BASE_URL && env.DIFY_CHAT_APP_KEY)
  return new Response(
    JSON.stringify({
      status: 'ok',
      db,
      ts: new Date().toISOString(),
      ai: { configured, source: configured ? 'dify' : 'rule' },
      deploy: env.CF_PAGES_COMMIT_SHA ? String(env.CF_PAGES_COMMIT_SHA).slice(0, 7) : null,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
