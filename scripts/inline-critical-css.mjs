// 首屏 CSS 内联（构建期，只动 dist）：把入口 <link rel=stylesheet> 换成 <style>，
// 并把该样式的 **sha256 哈希**补进 dist/index.html 的 CSP meta（style-src 'self' '<hash>'）。
//
// 为什么走哈希而不是 'unsafe-inline'：仓内 scripts/check-csp-static.mjs 明确禁 unsafe-inline/unsafe-hashes
//（那条门禁只扫源码与 public，但**红线是同一份 CSP**）；Rust 边缘的内联也是哈希口径，两边同源。
//
// 为什么在构建期做而不是运行时：线上托管侧是 Cloudflare Pages 静态托管，没有可编程的响应体重写；
// 唯一能改首屏 HTML 的时机就是构建。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dist = path.join(root, 'dist')
const htmlPath = path.join(dist, 'index.html')

if (!existsSync(htmlPath)) {
  console.error('[inline-css] dist/index.html 不存在 ⇒ 先跑 vite build')
  process.exit(2)
}
let html = readFileSync(htmlPath, 'utf8')

// 幂等：已经内联过就跳过（重复跑 build 不会把哈希叠第二遍）
if (/<style[\s>]/i.test(html) && /style-src[^;]*sha256-/.test(html)) {
  console.log('[inline-css] 已是内联口径，跳过')
  process.exit(0)
}

// 找入口样式表链接（Vite 产物形态：<link rel="stylesheet" crossorigin href="./assets/index-XXXX.css">）
const linkRe = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/i
const link = linkRe.exec(html)
if (!link) {
  console.error('[inline-css] 没找到 <link rel=stylesheet> ⇒ 产物形态变了，本脚本拒绝猜（宁可不动）')
  process.exit(2)
}
const href = /href=["']([^"']+)["']/i.exec(link[0])
if (!href) {
  console.error('[inline-css] 样式表链接没有 href')
  process.exit(2)
}
const cssRel = href[1].replace(/^\.\//, '')
const cssPath = path.join(dist, cssRel)
if (!existsSync(cssPath)) {
  console.error('[inline-css] 样式表文件不存在：' + cssRel)
  process.exit(2)
}
const css = readFileSync(cssPath, 'utf8')
// 内联进 <style> 后若能提前闭合标签，就是把 CSS 变成标记注入 —— 直接拒绝而不是转义（转义会改样式语义）
if (/<\/style/i.test(css)) {
  console.error('[inline-css] CSS 含 </style ⇒ 内联不安全，已中止')
  process.exit(2)
}
const hash = 'sha256-' + createHash('sha256').update(css, 'utf8').digest('base64')

// ① 换链接为内联 <style>（保留 crossorigin 语义无关，样式同源）
html = html.replace(link[0], '<style>' + css + '</style>')
// ② 把哈希补进 CSP 的 style-src —— **必须只在 CSP meta 的 content 里动手**。
// 第一版按裸正则 /style-src[^;]*/ 全局找第一处匹配，结果命中 HTML 注释里的
// 「去掉 style-src 'unsafe-inline'」那句话，哈希被插进了注释：文件里"有"这串哈希
//（于是粗判据误判绿），而真正的 CSP 仍是 style-src 'self' ⇒ 内联样式上线即被拦。
// 现在改成先锁定 meta 的 content group，再在其中的 style-src 段落插入。
const cspMetaRe = /(<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=)(["'])([\s\S]*?)\2/i
const cspMeta = cspMetaRe.exec(html)
if (!cspMeta) {
  console.error('[inline-css] 没找到 CSP meta ⇒ 无法授权内联，已回滚')
  process.exit(2)
}
const cspBody = cspMeta[3]
if (!/\bstyle-src\b/.test(cspBody)) {
  console.error('[inline-css] CSP 里没有 style-src ⇒ 无法授权内联，已回滚')
  process.exit(2)
}
const patchedBody = cspBody.replace(/(style-src[^;]*)/, (m) => (m.includes(hash) ? m : m.trimEnd() + " '" + hash + "'"))
if (patchedBody === cspBody) {
  console.error('[inline-css] style-src 授权未发生变化 ⇒ 中止（不写半成品）')
  process.exit(2)
}
html = html.slice(0, cspMeta.index) + cspMeta[1] + cspMeta[2] + patchedBody + cspMeta[2] + html.slice(cspMeta.index + cspMeta[0].length)
writeFileSync(htmlPath, html)
const outBytes = Buffer.byteLength(html, 'utf8')

// ③ dist/_headers：给入口 chunk 加 `Link: rel=preload` —— 托管侧能表达的「更早开始下载入口」。
// 为什么必须构建期生成：文件名带内容 hash（assets/index-XXXX.js），每次构建都变 ⇒ 手写会立刻过期。
// 幂等靠哨兵注释：重写前先删掉上一次生成的那一段（不碰 public/_headers 里人写的那部分语义声明）。
const entryScript = /<script\b[^>]*\bsrc=["'](\.?\/assets\/[^"']+\.js)["']/i.exec(html)
if (entryScript) {
  const entryUrl = '/' + entryScript[1].replace(/^\.\//, '')
  const headersPath = path.join(dist, '_headers')
  // ── 额外预载：镜像 rust/crates/edge/src/shell.rs 的三条规则 ──
  // ① 首屏路由 chunk：托管侧按产物 glob（Vite 的 chunk 名取自模块名，稳定但不写死在代码里 ——
  //    与 shell.rs 那条「字体一律从产物自己的 preload 里取」同源：只留一份真相）。
  //    ⚠️ URL 的 hash 片段根本不会发给服务端 ⇒ /#/shop 与 / 拿到的是同一份头，
  //    所以这条只能押默认落地路由（首页），押不到别的路由。权衡写在这里，不藏。
  const routeLinks = []
  try {
    for (const f of readdirSync(path.join(dist, "assets"))) {
      if (/^HomePage-[A-Za-z0-9_-]+[.]js$/.test(f)) routeLinks.push("/assets/" + f)
    }
  } catch {
    // 产物里没有 assets/ 目录：跳过而不是编一个名字（宁可少一条预载，也不预载一个 404）
  }
  // ② 字体：从产物 HTML 自己的 <link rel=preload as=font> 取（属性顺序不固定 ⇒ 按整标签判定再取 href）
  const fontLinks = []
  for (const tag of html.match(/<link[^>]*>/gi) || []) {
    if (!/rel=["']preload["']/i.test(tag) || !/as=["']font["']/i.test(tag)) continue
    const m = /href=["']([^"']+)["']/i.exec(tag)
    if (m) fontLinks.push(m[1].replace(/^[.][/]/, "/"))
  }
  // ③ 样式表不进 Link（已内联；再提示一次等于白花一次请求）—— 与 shell.rs 跳过 kind=style 一致
  const extraLinks = [...routeLinks, ...fontLinks]
  const SENTINEL_START = '# >>> inline-css 生成段（构建期重写，勿手改）>>>'
  const SENTINEL_END = '# <<< inline-css 生成段 <<<'
  if (existsSync(headersPath)) {
    let h = readFileSync(headersPath, 'utf8')
    const startAt = h.indexOf(SENTINEL_START)
    const endAt = h.indexOf(SENTINEL_END)
    if (startAt >= 0 && endAt > startAt) h = (h.slice(0, startAt) + h.slice(endAt + SENTINEL_END.length)).replace(/\n{3,}/g, '\n\n')
    // 预载行：Link 头的语法是 <url>; rel=preload; as=script|font; crossorigin（少了尖括号就是无效头）
    const entryLine = '  Link: <' + entryUrl + '>; rel=preload; as=script; crossorigin'
    const extraLines = extraLinks.map((u) => '  Link: <' + u + '>; rel=preload; as=' + (/[.]woff2?$/i.test(u) ? 'font' : 'script') + '; crossorigin')
    const block = [
      SENTINEL_START,
      '# 首屏预载（构建期按本次产物的 hash 生成）：入口 + 首屏路由 chunk + 字体',
      '# inline-css-bytes: ' + Buffer.byteLength(css, 'utf8'),
      '/index.html',
      entryLine,
      ...extraLines,
      '/',
      entryLine,
      ...extraLines,
      SENTINEL_END,
      '',
    ].join('\n')
    writeFileSync(headersPath, h.trimEnd() + '\n' + block)
    console.log('[inline-css] _headers 已写入预载：入口 ' + entryUrl + '｜路由 ' + routeLinks.length + ' 条｜字体 ' + fontLinks.length + ' 条')
  } else {
    console.log('[inline-css] dist/_headers 不存在，跳过 Link 预载（不改平台默认行为）')
  }
}
console.log('[inline-css] 已内联 ' + cssRel + '（' + Buffer.byteLength(css, 'utf8') + ' B）→ index.html 现 ' + outBytes + ' B；CSP 哈希 ' + hash.slice(0, 24) + '…')
