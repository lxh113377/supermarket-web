// 打印页 = 校园打印（CampusPrint-V1）应用本身，**同源就地提供**：本站不再有自建打印页，
// 也不再往任何外部域名跳。仓库 k01055119509-lang/CampusPrint-V1。
//
// 落地形态：
//   · 该应用的学生端静态面（frontend/shared/** + frontend/user/**）原样落在本站 public/ 下，
//     入口页 = public/print/index.html（内容一字未改，只归一行尾；由 scripts/print-parity.mjs 逐文件对账）；
//   · 它的 /api 由本站同源反代（dev/preview = vite.config.js 的 proxy；线上 = functions/api/[[path]].js）。
//
// 为什么绝不做跨域跳转（2026-10-22 一手事故）：顾客端在微信内打开，
//   从 lxh113377.github.io 自动跳到 supermarket-web.pages.dev 会命中微信的
//   「即将前往以下网址，无法确认本次跳转是否安全」拦截页 —— 用户看到的是白屏 + 一个
//   「申请恢复访问」，等于打印功能对微信用户直接消失。跳转本身还是二次导航，
//   把已经加载好的应用换成一次网络往返。所以这一层的唯一正确形态是**同源路径**。
//
// 地址只允许同源路径（或构建期显式配一个同源子路径）。不给 http(s) 外部域名留后门：
//   那正是上面那条事故的入口。

/** 打印页的站内入口：同源静态面 + 直达打印下单视图（hash 路由由该应用自己处理）。 */
export const CAMPUS_PRINT_PATH = '/print/#print'

/**
 * 本页所承载的校园打印版本（与上游 package.json 同值）。
 * 判据 scripts/print-parity.mjs 的 P3 腿把这里、docs/campus-print.json、上游 package.json 三处对账 ——
 * 三处不同值 = 静态面与上游已漂移（散文提醒会被忘，等号不会）。
 */
export const CAMPUS_PRINT_BUILD = '1.4.0'

/**
 * 把外部输入（构建期 env）收敛成**同源路径**；不是同源路径一律返回 null。
 * 拒的三类都是真实风险：可执行协议（javascript:/data:）= XSS 出口；
 * 协议相对（//host）与绝对 URL = 跨域导航，会再撞一次微信拦截页。
 */
export function normalizeCampusPrintPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || !value.startsWith('/')) return null
  // '//host' 是协议相对地址（等于跨域），不是同源路径。
  if (value.startsWith('//')) return null
  // 只给「纯路径」补结尾斜杠：带 query/hash 的补斜杠会把 ?x=1 变成 ?x=1/（错的）。
  if (/[?#]/.test(value)) return value
  return value.endsWith('/') ? value : value + '/'
}

/** 解析打印页地址：配置合法就用配置，否则用站内默认入口（绝不返回空串，也绝不给外部域名）。 */
export function resolveCampusPrintUrl(
  raw: unknown = (import.meta.env as Record<string, unknown> | undefined)?.VITE_CAMPUS_PRINT_URL,
): string {
  return normalizeCampusPrintPath(raw) ?? CAMPUS_PRINT_PATH
}
