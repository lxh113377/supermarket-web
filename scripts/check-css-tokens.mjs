#!/usr/bin/env node
/**
 * CSS 令牌「引用⇄定义」对账闸（第 90 轮，治 forest 同族病第四次复发）。
 *
 * 一手动因（2026-10-26 实测，非推演）：tailwind 的 forest 族自 v3 重构起引用
 * `--t-forest*`，而 :root 从未定义；v4 把类目横带换成 to-forest 后暴露 ——
 * 生活/学习两类封面带 computed invalid-at-computed-value-time 整链清空，
 * **线上自 v4 起透明**。同族病史：v4 手术漏 espresso ⇒ 黄铜底字色塌 2.87；
 * 漏 on-brass ⇒ 整排钮字塌回米白。三次都是「引用面改了、定义面没跟上」，
 * 而没有任何一把尺在量「引用了的变量是否都有定义」—— 构建不报错（CSS 变量
 * 缺失是运行时 invalid，不是编译错误）、对比度闸也抓不到（祖先背景取样口径）。
 *
 * 判据口径（双向差集，同 check-eol-purity 的 E8 形态）：
 *   T1 引用面非空（零输入不得 PASS：src 扫不出任何 var(--t-*) = 取数面坏了）
 *   T2 引用⇄定义：每个被引用的 --t-* 都在 index.css :root 有定义（缺 ⇒ RED 点名）
 *   T3 定义⇄引用：定义了却无人引用的 --t-* ⇒ WARN 点名（v4 折叠留下的死槽是存量，
 *      不拦；但新加死槽会被看见 —— 「只报不拦」是刻意的：删存量死槽是另一个决定）
 *   T4 取数面：index.css :root 块与 src 目录都可读（读不到 ⇒ rc=2，未观测不是通过）
 *
 * 退出码：0=PASS（含 WARN）/ 1=T2 判红 / 2=取数面不可读。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_CSS = join(ROOT, 'src', 'index.css')
const SRC = join(ROOT, 'src')
const TW = join(ROOT, 'tailwind.config.js')

/** 剥注释再匹配：tailwind 头注里的示例 `rgb(var(--t-x) / <alpha-value>)` 是文档
 *  不是引用（2026-10-26 首跑误报 T2 红）。块注释整段剥；行注释只剥非协议位的 //
 *  （URL 里的 :// 不许被当注释起点）。 */
export function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:/])\/\/.*$/gm, '$1')
}

/** 扫一个目录里所有 css/js/ts/tsx 的 var(--t-*) 引用名（去重 + 记出处）。 */
export function collectRefs(dir = SRC, extra = [TW]) {
  const refs = new Map()
  const add = (name, file) => {
    if (!refs.has(name)) refs.set(name, new Set())
    refs.get(name).add(file)
  }
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const fp = join(d, f)
      if (statSync(fp).isDirectory()) { walk(fp); continue }
      if (!/\.(css|js|ts|tsx)$/.test(f)) continue
      const t = stripComments(readFileSync(fp, 'utf8'))
      for (const m of t.matchAll(/var\((--t-[a-z0-9-]+)/g)) add(m[1], f)
    }
  }
  walk(dir)
  for (const fp of extra) {
    if (!existsSync(fp)) continue
    const t = stripComments(readFileSync(fp, 'utf8'))
    for (const m of t.matchAll(/var\((--t-[a-z0-9-]+)/g)) add(m[1], fp.split(/[\\/]/).pop())
  }
  return refs
}

/** 从 index.css 的 :root 块里取定义名集合。取不到块 ⇒ null（未观测）。 */
export function collectDefs(cssPath = TOKEN_CSS) {
  if (!existsSync(cssPath)) return null
  const t = readFileSync(cssPath, 'utf8')
  const start = t.indexOf(':root {')
  if (start < 0) return null
  const end = t.indexOf('}', start)
  if (end < 0) return null
  const block = t.slice(start, end)
  return new Set([...block.matchAll(/(--t-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
}

export function evaluate({ refs, defs }) {
  const rows = []
  if (!refs || refs.size === 0) {
    rows.push({ id: 'T1', pass: false, unverified: true, detail: '引用面为空（src + tailwind 扫不出任何 var(--t-*)）⇒ 取数面坏了，不是"没有引用"' })
    return { rows, rc: 2 }
  }
  rows.push({ id: 'T1', pass: true, detail: `引用面 ${refs.size} 个 --t-* 令牌（src 全扫 + tailwind.config.js）` })
  if (!defs) {
    rows.push({ id: 'T4', pass: false, unverified: true, detail: 'index.css 的 :root 块取不到 ⇒ 定义面无从对账，未观测不是通过' })
    return { rows, rc: 2 }
  }
  const missing = [...refs.keys()].filter((k) => !defs.has(k))
  rows.push({
    id: 'T2', pass: missing.length === 0,
    detail: missing.length === 0
      ? `引用 ${refs.size} 个全部有 :root 定义（forest 同族病零复发）`
      : `引用了却无定义 ${missing.length} 个：${missing.map((k) => `${k} ← ${[...refs.get(k)].slice(0, 2).join(',')}`).join(' ; ')} ⇒ computed invalid-at-computed-value-time，整条 var 链清空（forest 病形态）`,
  })
  const unused = [...defs].filter((k) => !refs.has(k))
  rows.push({
    id: 'T3', pass: true, warn: unused.length > 0,
    detail: unused.length
      ? `定义却无人引用 ${unused.length} 个（存量死槽，只报不拦）：${unused.slice(0, 8).join(', ')}${unused.length > 8 ? ' …' : ''}`
      : '定义面全部被引用（无死槽）',
  })
  const bad = rows.filter((r) => r.pass === false && !r.unverified)
  const unver = rows.filter((r) => r.unverified)
  return { rows, rc: bad.length ? 1 : (unver.length ? 2 : 0) }
}

export function main() {
  let refs = null
  try { refs = collectRefs() } catch (e) {
    console.error('[css-tokens] 引用面扫不动：' + String(e.message || e).split('\n')[0] + ' ⇒ 未观测')
    return 2
  }
  const defs = collectDefs()
  const { rows, rc } = evaluate({ refs, defs })
  for (const r of rows) {
    const tag = r.unverified ? 'UNVERIFIED' : (r.pass ? (r.warn ? 'WARN' : 'PASS') : 'FAIL')
    console.log(`${tag} ${r.id} :: ${r.detail}`)
  }
  const t2 = rows.find((r) => r.id === 'T2')
  console.log(`GATE-${rc === 0 ? 'PASS' : rc === 1 ? 'FAIL' : 'UNVERIFIED'} css-tokens :: 引用 ${refs.size}｜定义 ${defs ? defs.size : '-'}｜缺定义 ${t2 && !t2.pass ? '有' : '0'}`)
  return rc
}

if (process.argv[1] && process.argv[1].endsWith('check-css-tokens.mjs')) {
  process.exit(main())
}
