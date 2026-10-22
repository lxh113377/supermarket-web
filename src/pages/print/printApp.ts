// 打印页 = 校园打印（CampusPrint-V1）应用本身：本页现在整体由该应用承担，
// 本站只保留「把浏览器送到那个页面」这一层。仓库 k01055119509-lang/CampusPrint-V1。
//
// 落地形态（2026-10-21）：
//   · 该应用的学生端静态面（frontend/shared/** + frontend/user/**）原样落在本站 public/ 下
//     —— /shared/**、/user/** 的绝对路径因此原封不动可用，页面在 **/print/** 打开；
//   · 它的 /api 由本站同源反代（dev = vite.config.js 的 proxy；线上 = functions/api/[[path]].js）。
//
// 为什么必须同源反代、不能直接跳去它自己的域名：
//   它的服务端有两道同源守卫（backend/app.js 实测）：Origin 必须等于它自己的 PUBLIC_ORIGIN、
//   且 Sec-Fetch-Site 不得是 cross-site —— 从本站点过去的任何跨站导航/请求会被 403
//   （实测：直跳 127.0.0.1:4328 拿到 {"code":"FORBIDDEN_ORIGIN"}）。同源反代把这两个头归一化后
//   它才肯服务（dev 代理与 Pages Function 都做同一件事）。
//
// 顾客端（github.io）没有 Pages Functions ⇒ /api 无从代理，故那边显式指向 Pages 部署。
// 三个地址都只是"默认值"，构建期可用 VITE_CAMPUS_PRINT_URL 覆盖（见 docs/env-vars.md）。

/** 本机与 Pages 部署的内置入口：同源静态面 + 直达打印下单视图。 */
export const DEFAULT_CAMPUS_PRINT_URL = '/print/#print'

/**
 * 本页所承载的校园打印版本（与上游 package.json 同值）。
 * 判据 scripts/print-parity.mjs 的 P3 腿把这里、docs/campus-print.json、上游 package.json 三处对账 ——
 * 三处不同值 = 静态面与上游已漂移（散文提醒会被忘，等号不会）。
 */
export const CAMPUS_PRINT_BUILD = '1.4.0'

/** 顾客端（GitHub Pages 静态托管）没有 /api 反代，只能指向带 Functions 的 Pages 部署。 */
export const PAGES_REMOTE_PRINT_URL = 'https://supermarket-web.pages.dev/print/#print'

/** 静态托管、没有 Pages Functions 的顾客端主机（与 functions/lib/security.js 的默认源同源同值）。 */
export const NO_API_PROXY_HOSTS = ['lxh113377.github.io']

/**
 * 把任意外部输入（构建期 env / 运行时主机名）收敛成一个可跳转的地址。
 * 只放行 http(s) 绝对地址与以 `/` 开头的同源路径；其余一律返回 null
 * —— 宁可用默认值，也不把 `javascript:` / `data:` 这类可执行协议做成跳转目标。
 */
export function normalizeCampusPrintUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith('/')) {
    // '//host' 是协议相对地址（等于跨站），不是同源路径，直接拒。
    if (value.startsWith('//')) return null
    // 只给"纯路径"补结尾斜杠：带 query/hash 的路径补斜杠会把 ?x=1 变成 ?x=1/（错的）。
    if (/[?#]/.test(value)) return value
    return value.endsWith('/') ? value : value + '/'
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // URL 自己已把空路径补成 '/'（https://a → https://a/），这里不再手工拼接，
  // 免得把 https://a/path?x=1 拼成 ...?x=1/。
  return url.href
}

/** 解析打印页目标地址：配置合法就用配置；顾客端主机指向 Pages；其余用同源默认入口。 */
export function resolveCampusPrintUrl(
  raw: unknown = (import.meta.env as Record<string, unknown> | undefined)?.VITE_CAMPUS_PRINT_URL,
  hostname: unknown = typeof window !== 'undefined' ? window.location.hostname : undefined,
): string {
  const configured = normalizeCampusPrintUrl(raw)
  if (configured) return configured
  if (typeof hostname === 'string' && NO_API_PROXY_HOSTS.includes(hostname)) return PAGES_REMOTE_PRINT_URL
  return DEFAULT_CAMPUS_PRINT_URL
}
