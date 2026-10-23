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
 * 备用入口：本站自建的「服务提交表单」，同样是一个 hash 路由。
 * 只在**跑不了 Pages Functions 的纯静态托管**（GitHub Pages）上用：那里同源 `/api` 必 404，
 * 搬进来的应用对顾客只剩一张「无法读取服务配置」的死页（2026-10-23 微信 UA 浏览器实测），
 * 而这把表单走 /upload + /pub（两条都有跨域 CORS），实测能提交、后台能取回文件本体。
 */
export const CAMPUS_PRINT_FORM_PATH = '/#/service/print'

/** 顾客端静态托管的宿主特征（只用来在**两个同源路径**之间二选一，绝不拼出跨域地址）。 */
export function isStaticCustomerHost(hostname: string): boolean {
  return /(^|\.)github\.io$/i.test(String(hostname || '').split(':')[0])
}

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

/**
 * 纯函数版判定（给单测用）：显式配置合法 ⇒ 用它；否则按**宿主**在两个同源路径里选一个。
 * 为什么默认值要看宿主而不是看构建参数（2026-10-23 一手）：我先前给 github.io 的
 * deploy.yml 配了 `VITE_CAMPUS_PRINT_URL`，于是同一份源码在两个域名上产出**不同的入口
 * bundle 名**，把 `scripts/verify-release-parity.mjs` 的「两端入口 bundle 同为 x」判成红 ——
 * 那条判据没错，它抓到的是真问题：两端不再是同一批产物，任何「两端同批」的推理都失效。
 * 所以分叉挪到运行时：一份构建两个域名通用，产物逐字节相同。
 * 仍是**同源路径**二选一 ⇒ 撞不到微信那条跨域导航拦截页。
 */
export function pickCampusPrintPath(hostname: string, raw: unknown): string {
  return normalizeCampusPrintPath(raw)
    ?? (isStaticCustomerHost(hostname) ? CAMPUS_PRINT_FORM_PATH : CAMPUS_PRINT_PATH)
}

/** 解析打印页地址：配置合法就用配置，否则按宿主取默认（绝不返回空串，也绝不给外部域名）。 */
export function resolveCampusPrintUrl(
  raw: unknown = (import.meta.env as Record<string, unknown> | undefined)?.VITE_CAMPUS_PRINT_URL,
): string {
  // 没有 window 的环境（单测 node 侧、SSR 兜底）按服务端宿主处理：给应用页那个默认值，
  // 与改动前的行为逐字一致，不让判据因为「取不到宿主」而漂到另一个分支。
  const host = typeof window === 'undefined' ? '' : window.location.hostname
  return pickCampusPrintPath(host, raw)
}
