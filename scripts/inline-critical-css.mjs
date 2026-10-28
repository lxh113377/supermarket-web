// 首屏 CSS 内联（构建期，只动 dist）：把入口 <link rel=stylesheet> 换成 <style>，
// 并把该样式的 **sha256 哈希**补进 dist/index.html 的 CSP meta（style-src 'self' '<hash>'）。
//
// 为什么走哈希而不是 'unsafe-inline'：仓内 scripts/check-csp-static.mjs 明确禁 unsafe-inline/unsafe-hashes
//（那条门禁只扫源码与 public，但**红线是同一份 CSP**）；Rust 边缘的内联也是哈希口径，两边同源。
//
// 为什么在构建期做而不是运行时：线上托管侧是 Cloudflare Pages 静态托管，没有可编程的响应体重写；
// 唯一能改首屏 HTML 的时机就是构建。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  const SENTINEL_START = '# >>> inline-css 生成段（构建期重写，勿手改）>>>'
  const SENTINEL_END = '# <<< inline-css 生成段 <<<'
  if (existsSync(headersPath)) {
    let h = readFileSync(headersPath, 'utf8')
    const startAt = h.indexOf(SENTINEL_START)
    const endAt = h.indexOf(SENTINEL_END)
    if (startAt >= 0 && endAt > startAt) h = (h.slice(0, startAt) + h.slice(endAt + SENTINEL_END.length)).replace(/\n{3,}/g, '\n\n')
    const block = [
      SENTINEL_START,
      '# 入口 chunk 预载：解析 HTML 之前就开始下载（与内存内联同一处产出，hash 由本次构建决定）',
      // 把内联字节数写进生成段：判据据此核对「内联过程没悄悄改内容」（此前该标记没人写，是条死腿）
      '# inline-css-bytes: ' + Buffer.byteLength(css, 'utf8'),
      '/index.html',
      '  Link: <' + entryUrl + '>; rel=preload; as=script; crossorigin',
      '/',
      '  Link: <' + entryUrl + '>; rel=preload; as=script; crossorigin',
      SENTINEL_END,
      '',
    ].join('\n')
    writeFileSync(headersPath, h.trimEnd() + '\n' + block)
    console.log('[inline-css] _headers 已写入入口预载：' + entryUrl)
  } else {
    console.log('[inline-css] dist/_headers 不存在，跳过 Link 预载（不改平台默认行为）')
  }
}
console.log('[inline-css] 已内联 ' + cssRel + '（' + Buffer.byteLength(css, 'utf8') + ' B）→ index.html 现 ' + outBytes + ' B；CSP 哈希 ' + hash.slice(0, 24) + '…')
