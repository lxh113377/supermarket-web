// 内联首屏 CSS 的**校验**（构建后跑）：证明「链接没了、哈希对得上、样式没被截断」，并自证有牙。
//
// 负控：脚本支持 --negative-control —— 把内联样式的哈希故意改错一位，判据必须报红（否则这条门禁是恒绿的摆设）。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dist = path.join(root, 'dist')
const htmlPath = path.join(dist, 'index.html')
const negative = process.argv.includes('--negative-control')

if (!existsSync(htmlPath)) { console.error('[inline-css] 缺 dist/index.html'); process.exit(2) }
let html = readFileSync(htmlPath, 'utf8')
if (negative) html = html.replace(/(sha256-)([A-Za-z0-9+/])/, '$1A') // 故意改坏一位

const problems = []
const styleTag = /<style[\s>]([\s\S]*?)<\/style>/i.exec(html)
if (!styleTag) problems.push('没有内联 <style> ⇒ 首屏 CSS 仍在外部链接上（渲染阻塞未消除）')
if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) problems.push('仍存在 <link rel=stylesheet> ⇒ 内联没生效或重复')
if (styleTag) {
  const css = styleTag[1]
  const hash = 'sha256-' + createHash('sha256').update(css, 'utf8').digest('base64')
  // 关键：哈希必须落在 **CSP meta 的 style-src 指令** 里。
  // 只查 html.includes(hash) 是**不够的** —— 第一版内联把哈希插进了 HTML 注释（命中注释里的
  // 「去掉 style-src 'unsafe-inline'」那句），文件里确实"有"这串哈希，粗判据因此误判绿，
  // 而真正的 CSP 仍是 style-src 'self' ⇒ 内联样式上线即被拦。这条判据现在按指令取值比对。
  const cspMeta = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])([\s\S]*?)\1/i.exec(html)
  if (!cspMeta) {
    problems.push('找不到 CSP meta ⇒ 无法核对内联哈希的授权')
  } else {
    const styleDir = cspMeta[2].split(';').map((s) => s.trim()).find((s) => s.startsWith('style-src'))
    if (!styleDir) problems.push('CSP 里没有 style-src 指令')
    else if (!styleDir.includes(hash)) problems.push('CSP 的 style-src 里没有这把哈希（' + hash.slice(0, 20) + '…）⇒ 内联样式会被拦掉，首屏等于没样式')
    if (styleDir && styleDir.includes("'unsafe-inline'")) problems.push("style-src 含 'unsafe-inline' ⇒ 回退了 F2 的收紧")
  }
  // 截断自检：产物里的 CSS 必须与磁盘上的同名字节数一致（内联过程不许悄悄改内容）
  const hp = path.join(dist, '_headers')
  if (existsSync(hp)) {
    const marker = /inline-css-bytes:\s*(\d+)/.exec(readFileSync(hp, 'utf8'))
    if (!marker) problems.push('dist/_headers 生成段缺 inline-css-bytes 标记（生产者没写 ⇒ 截断自检无从对账）')
    else if (Number(marker[1]) !== Buffer.byteLength(css, 'utf8')) {
      problems.push('内联样式字节数与标注不符（' + Buffer.byteLength(css, 'utf8') + ' vs ' + marker[1] + '）')
    }
  }
}
// 字体 preload 必须还在（内联不该顺手删掉别的 head 内容）
if (!/<link\b[^>]*rel=["']preload["'][^>]*as=["']font["']/i.test(html)) problems.push('字体 preload 丢了')
// _headers 的入口预载必须指向**本次构建**里真实存在的入口 chunk（写错文件名=白预载一个 404）
const headersPath2 = path.join(dist, '_headers')
if (existsSync(headersPath2)) {
  const h = readFileSync(headersPath2, 'utf8')
  // 生成段里的**每一行** Link 都必须语法合法（少了尖括号就是无效头、浏览器会整条丢掉），
  // 且指向的文件必须真实存在。第一版只按 /Link:\s*<([^>]+)>/ 抓「合法形状」⇒ 我自己产出的
  // 「Link: /assets/HomePage-….js」这种畸形行**不匹配就不被检查**，于是它溜过了判据。
  for (const raw of h.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('Link:')) continue
    if (!/^Link:\s*<[^>]+>;\s*rel=preload;\s*as=(script|font)(;\s*crossorigin)?$/.test(line)) {
      problems.push('生成段的 Link 语法非法（浏览器会整条忽略）：' + line)
    }
    const u = /<([^>]+)>/.exec(line)
    if (u && !existsSync(path.join(dist, u[1].replace(/^[/]/, '')))) problems.push('生成段的预载指向不存在的文件：' + u[1])
    if (u && /[.]css$/i.test(u[1])) problems.push('样式表不该再进 Link（已内联）：' + u[1])
  }
  // 生成段里每一条 Link 指向的文件都必须真实存在；有候选却没带也报
  for (const m2 of h.matchAll(/Link:[ ]*<([^>]+)>;[ ]*rel=preload/gi)) {
    const u = m2[1]
    if (!existsSync(path.join(dist, u.replace(/^[/]/, "")))) problems.push("生成段的预载指向不存在的文件：" + u)
    if (/[.][c]ss$/.test(u)) problems.push("样式表不该再进 Link（已内联）：" + u)
  }
  try {
    const cand = readdirSync(path.join(dist, "assets")).filter((f) => /^HomePage-[A-Za-z0-9_-]+[.]js$/.test(f))
    if (cand.length && !cand.some((f) => h.includes("/assets/" + f))) problems.push("产物里有首屏路由 chunk 却没进预载：" + cand[0])
  } catch {}
  for (const tag of html.match(/<link[^>]*>/gi) || []) {
    if (!/rel=["']preload["']/i.test(tag) || !/as=["']font["']/i.test(tag)) continue
    const m3 = /href=["']([^"']+)["']/i.exec(tag)
    if (m3 && !h.includes(m3[1].replace(/^[.][/]/, "/"))) problems.push("字体没进预载：" + m3[1])
  }
  const m = /Link:\s*<(\/assets\/[^>]+)>;\s*rel=preload;\s*as=script/i.exec(h)
  if (!m) problems.push('_headers 里没有入口 chunk 的 Link 预载')
  else if (!existsSync(path.join(dist, m[1].replace(/^\//, '')))) problems.push('_headers 预载指向的文件不存在：' + m[1])
  const entry = /<script\b[^>]*\bsrc=["'](\.?\/assets\/[^"']+\.js)["']/i.exec(html)
  if (entry && m && !m[1].endsWith(entry[1].replace(/^\.\//, ''))) problems.push('_headers 预载的入口与 index.html 实际引用的入口不一致（' + m[1] + ' vs ' + entry[1] + '）')
}

if (problems.length) {
  for (const p of problems) console.error('  - ' + p)
  console.error('[inline-css] ' + (negative ? '负控按预期判红（判据有牙）' : 'FAIL ' + problems.length + ' 项'))
  process.exit(negative ? 0 : 1)
}
if (negative) { console.error('[inline-css] 负控没判红 ⇒ 判据是恒绿摆设'); process.exit(1) }
console.log('[inline-css] OK 首屏 CSS 已内联、CSP 哈希对得上、无渲染阻塞样式表')
