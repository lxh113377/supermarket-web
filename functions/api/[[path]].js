// 打印页（/print = 外站「校园打印」应用 CampusPrint-V1）的 /api 同源反代。
//
// 为什么需要这一层：该应用自带 Node 后端（Express 5 + node:sqlite + PDF/图像渲染），静态托管跑不了；
// 而它的服务端只认同源 —— backend/app.js 对每个进来的请求都查三件事：
//   ① Host 必须等于它自己的 PUBLIC_ORIGIN（由 fetch 按目标地址给出，天然满足）
//   ② Origin 若存在必须等于它自己（浏览器从本站发出去的是本站 Origin ⇒ 必须去掉）
//   ③ Sec-Fetch-Site 不得是 cross-site（同理去掉）
// 2026-10-21 实测：直连它的域名（cross-site）与带本站 Origin 的请求都回 FORBIDDEN_ORIGIN；
// 走本反代（浏览器→本站同源入口→Worker 出网）后 /api/public/config、/api/print/config、
// /api/auth/csrf、/api/auth/guest、/api/me/print-defaults 全部 200。
//
// 未配置 CAMPUS_PRINT_ORIGIN 时不静默降级：打印页拿到明确的 503 + 机器可读 code，
// 而不是一个"看起来像没数据"的空白页。

import { forwardHeaders } from '../lib/print-proxy.js'

const UNAVAILABLE = 'PRINT_APP_UNAVAILABLE'

/** 与校园打印客户端的错误封套同形（{success,error:{code,message,fields}}），否则它读不出人话。 */
function unavailable(message) {
  return new Response(JSON.stringify({ success: false, error: { code: UNAVAILABLE, message, fields: {} } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function onRequest({ request, env }) {
  // 与其它入口同形：从 context 解构 env 变量（check-env-docs 认定的是裸 env.X 形态）。
  const configured = env.CAMPUS_PRINT_ORIGIN
  if (!configured) return unavailable('打印应用未配置：请在 Pages 变量里设置 CAMPUS_PRINT_ORIGIN 指向该应用')
  let base
  try {
    base = new URL(configured)
  } catch {
    return unavailable('CAMPUS_PRINT_ORIGIN 不是合法地址（须形如 https://print.example.edu）')
  }

  const incoming = new URL(request.url)
  const target = new URL(incoming.pathname + incoming.search, base)
  const headers = forwardHeaders(request.headers)

  /** @type {RequestInit} 显式标注：redirect 是字面量联合类型，不标会被 checkJs 判成 string。 */
  const init = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body

  let upstream
  try {
    upstream = await fetch(target.toString(), init)
  } catch (error) {
    return unavailable('打印应用不可达：' + (error && error.message ? error.message : '网络错误'))
  }

  const out = new Headers(upstream.headers)
  // 传输层编码/长度归 Cloudflare 重算：上游那份留着会让浏览器按错误的字节数读 body。
  out.delete('content-encoding')
  out.delete('content-length')
  out.delete('transfer-encoding')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
