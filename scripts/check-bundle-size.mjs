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

// 预算（gzip 后字节）。基准来自 2026-09-23 实测：首屏 JS 77.9KB / CSS 8.7KB / 最大 chunk 58.1KB，
// 预算取实测上浮 15%~50%，既能拦住回归又不至于频繁误报。改这里前请先跑 --baseline 复核。
const BUDGET = {
  firstLoadJs: 90 * 1024,    // 首屏 JS（实测 77.9）
  firstLoadCss: 11 * 1024,   // 首屏 CSS（实测 8.7）
  largestChunk: 90 * 1024,   // 单个 chunk 上限（实测 58.1，防某个懒加载页面/依赖膨胀）
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
for (const u of refs) {
  const p = rel(u)
  if (!existsSync(p)) continue
  const size = gz(p)
  if (u.endsWith('.css')) firstCss += size
  else firstJs += size
}

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
