// 打印页（/print = 外站「校园打印」应用）的 /api 反代纯逻辑。
//
// 单独成模块的理由：转发时要丢掉哪几个头是这套反代**唯一的判断**，而它只能靠"真跑一次"才知道对不对
// （丢掉的不对 ⇒ 上游 403；丢多了 ⇒ 会话/CSRF 全断）。所以把它从路由文件里拆出来，由
// tests/printApp.test.ts 直接钉住"该丢的丢了、不该丢的一个没丢"。
//
// 丢掉的两类（理由见 functions/api/[[path]].js 文件头）：
//   · 同源守卫项：origin / sec-fetch-* —— 上游只认同源，带着本站的值会被 403
//   · 由出网重算项：host / content-length —— fetch 会按目标与真实 body 重新给出
export const DROPPED_HEADERS = ['origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'host', 'content-length']

/** 复制一份请求头并丢掉上述几项（其余原样保留：cookie / x-cp-surface / content-type 都必须留着）。 */
export function forwardHeaders(headers) {
  const out = new Headers(headers)
  for (const name of DROPPED_HEADERS) out.delete(name)
  return out
}
