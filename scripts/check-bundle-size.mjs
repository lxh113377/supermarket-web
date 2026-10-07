#!/usr/bin/env node
/**
 * 产物体积预算门禁（对标 P1-B2）
 *
 * 之前只有 vite 的 `chunkSizeWarningLimit: 800`（仅告警、不阻断），体积可以悄悄回归。
 * 本脚本从 dist/index.html 解析出**首屏真正会下载**的资源（入口 script + modulepreload + stylesheet），
 * 用 gzip 后体积比对预算，超阈值即 exit 1。
 *
 *   node scripts/check-bundle-size.mjs             # 按预算校验（需先 npx vite build）
 *   node scripts/check-bundle-size.mjs --baseline  # 打印实测值并给出建议预算（实测 ×1.15）
 *
 * 为什么用 gzip 而不是 raw：线上传输与 Core Web Vitals 看的是压缩后体积。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

// 预算（gzip 后字节）。基准：2026-09-23 实测首屏 JS 77.9KB → 2026-09-24 复测 86.4KB。
// 增量的实测归因：react-vendor 单块 66.0KB（占首屏 76%），来自 dependabot 轮 react 19.2→19.3
// + vite 8.2→8.3（rolldown 代码生成）整体抬了运行时基线；首屏其余部分（入口 5.2 + router 13.6
// + client/fields/runtime ≈ 1.6）无新增业务代码可削——HashRouter 首屏必须载 router，非懒加载能解。
// 因此这里按"实测 ×1.10"重设基线（而非放宽判据）：预算仍会拦住下一次无归因的增长。
// 改这里前请先跑 --baseline 复核，并在 CHANGELOG 写清归因。
const BUDGET = {
  firstLoadJs: 95 * 1024,    // 首屏 JS（2026-09-24 实测 86.4）
  firstLoadCss: 12 * 1024,   // 首屏 CSS（2026-10-07 实测 11.0）
  // 单个 chunk 上限。**2026-10-07 由 90KB 抬到 300KB**，归因（不抬就是必红）：
  //   打印页引入 three + @react-three/fiber 做滚动驱动的 3D 实景导航，
  //   three-vendor 单块实测 gzip 245.6KB（raw 953KB）—— 这是 WebGL 引擎本身的体积，
  //   不是业务代码膨胀，砍不掉；GSAP 因许可不在白名单被排除，drei 为避免引入
  //   未安装的可选 peer 也没有引入，已经是在能过许可门禁前提下的最小集。
  //   补偿措施（三重，缺一不可）：
  //     ① 打印页是 React.lazy 路由 + manualChunks 单独切成 three-vendor ⇒ **不进首屏**
  //        （实测首屏 JS 仍 88.2KB，与抬预算前同量级）；
  //     ② 打印页专属 CSS 独立成 print.css 随路由加载 ⇒ 首屏 CSS 不增长；
  //     ③ 无 WebGL / prefers-reduced-motion 时整块不挂载 ⇒ 低端机根本不下载它。
  //   因此这条预算现在管的是"下一个无归因的大块"，而不是拦住 3D。
  largestChunk: 300 * 1024,
}

const htmlPath = join(dist, 'index.html')
if (!existsSync(htmlPath)) {
  console.log('FAIL  dist/index.html 不存在 —— 先跑 npx vite build')
  process.exit(1)
}

const html = readFileSync(htmlPath, 'utf8')
const refs = new Set()
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1])
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) refs.add(m[1])
for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) refs.add(m[1])

const gz = (p) => gzipSync(readFileSync(p)).length
const rel = (u) => join(dist, u.replace(/^\.?\//, ''))

let firstJs = 0
let firstCss = 0
const firstParts = []
for (const u of refs) {
  const p = rel(u)
  if (!existsSync(p)) continue
  const size = gz(p)
  firstParts.push({ name: u.replace(/^\.?\/assets\//, ''), size })
  if (u.endsWith('.css')) firstCss += size
  else firstJs += size
}

// 归因输出：预算被吃掉时先看得见"谁吃的"，不用二次手工分析
const attr = firstParts.filter((x) => x.name.endsWith('.js')).sort((a, b) => b.size - a.size)
  .slice(0, 3).map((x) => `${x.name} ${(x.size / 1024).toFixed(1)}K`).join(' ｜ ')
console.log(`INFO  首屏 JS 构成 top3（gzip）：${attr}`)

const assetsDir = join(dist, 'assets')
const chunks = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => ({ f, gz: gz(join(assetsDir, f)), raw: statSync(join(assetsDir, f)).size }))
  : []
const largest = chunks.reduce((a, b) => (b.gz > (a?.gz ?? 0) ? b : a), null)
const totalJsRaw = chunks.reduce((s, c) => s + c.raw, 0)

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

if (process.argv.includes('--baseline')) {
  console.log(`[bundle-size] 首屏 JS gzip: ${kb(firstJs)}（${refs.size} 个首屏资源）`)
  console.log(`[bundle-size] 首屏 CSS gzip: ${kb(firstCss)}`)
  console.log(`[bundle-size] 最大 chunk gzip: ${largest ? kb(largest.gz) : 'n/a'}${largest ? ` (${largest.f})` : ''}`)
  console.log(`[bundle-size] 全部 JS raw 合计: ${kb(totalJsRaw)}（${chunks.length} 个 chunk）`)
  console.log(`[bundle-size] 建议预算（×1.15）：firstLoadJs=${Math.ceil((firstJs * 1.15) / 1024)}KB firstLoadCss=${Math.ceil((firstCss * 1.15) / 1024)}KB largestChunk=${Math.ceil(((largest?.gz || 0) * 1.15) / 1024)}KB`)
  process.exit(0)
}

let fail = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) fail++
}

check(firstJs <= BUDGET.firstLoadJs, `首屏 JS gzip ${kb(firstJs)} ≤ 预算 ${kb(BUDGET.firstLoadJs)}`)
check(firstCss <= BUDGET.firstLoadCss, `首屏 CSS gzip ${kb(firstCss)} ≤ 预算 ${kb(BUDGET.firstLoadCss)}`)
check((largest?.gz || 0) <= BUDGET.largestChunk, `最大 chunk gzip ${largest ? kb(largest.gz) : 'n/a'} ≤ 预算 ${kb(BUDGET.largestChunk)}`)
console.log(`\n==== 结果: ${3 - fail} 通过 / ${fail} 失败 ====`)
if (fail) {
  console.log('体积超出预算 —— 若确有必要增长，请跑 --baseline 复核后更新 BUDGET 并说明原因')
  process.exit(1)
}
console.log('全部通过 ✅')
