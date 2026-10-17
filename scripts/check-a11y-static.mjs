#!/usr/bin/env node
/**
 * a11y static gate (round 75, I-75-5).
 * Feeds every React TSX source under src/ into scripts/lib/a11y-rules.mjs.
 * Why a separate gate instead of only e2e: static rules answer within the same edit (e2e
 * needs a build plus a browser), while e2e alone can judge visibility/focusability.
 * Exit codes: 0 = clean / 1 = violations (file:line) / 2 = empty collection surface.
 * Usage: node scripts/check-a11y-static.mjs [--dir src] [--selftest] [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditSources } from './lib/a11y-rules.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-a11y-static.mjs')
export const DEFAULT_DIR = join(ROOT, 'src')

export function collect(dir) {
  const out = {}
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!name.endsWith('.tsx')) continue
      out[relative(ROOT, p).split('\\').join('/')] = readFileSync(p, 'utf8')
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

function selftest() {
  const cases = [
    ['1 img with alt (incl. decorative empty alt) => no finding', { 'a.tsx': '<img src={x} alt={p.name} /><img src={y} alt="" />' }, (r) => r.length === 0],
    ['2 img without alt => one finding with line number', { 'a.tsx': '<div>\n  <img src={x} />\n</div>' }, (r) => r.length === 1 && r[0].rule === 'img-alt' && r[0].line === 2],
    ['3 input with aria-label => no finding', { 'a.tsx': '<input type="number" aria-label="qty" />' }, (r) => r.length === 0],
    ['4 input with only placeholder => finding (placeholder is not an accessible name)', { 'a.tsx': '<input type="text" placeholder="note" />' }, (r) => r.length === 1 && r[0].rule === 'input-name'],
    ['5 input named via id + htmlFor => no finding', { 'a.tsx': '<label htmlFor="q">qty</label><input id="q" type="number" />' }, (r) => r.length === 0],
    ['6 input type=hidden is not a visible control => no finding', { 'a.tsx': '<input type="hidden" name="x" />' }, (r) => r.length === 0],
    ['7 div onClick without role/tabIndex/onKeyDown => finding (unreachable by keyboard)', { 'a.tsx': '<div onClick={() => go()}>buy</div>' }, (r) => r.length === 1 && r[0].rule === 'clickable-semantics'],
    ['8 same div with role+tabIndex+onKeyDown => no finding', { 'a.tsx': '<div role="button" tabIndex={0} onKeyDown={k} onClick={() => go()}>buy</div>' }, (r) => r.length === 0],
  ]
  let bad = 0
  for (const [name, sources, check] of cases) {
    let ok = false, note = ''
    try { ok = check(auditSources(sources)) } catch (e) { ok = false; note = ' (crash: ' + e.message + ')' }
    if (!ok) bad += 1
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + note)
  }
  console.log('[a11y-static] selftest ' + (cases.length - bad) + '/' + cases.length + (bad ? ' => a leg did not bite' : ''))
  return bad ? 1 : 0
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const i = argv.indexOf('--dir')
  const dir = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : DEFAULT_DIR
  const sources = collect(dir)
  const files = Object.keys(sources).length
  if (files === 0) {
    console.log('[a11y-static] UNVERIFIED collection surface is empty: ' + dir + ' (rc=2, empty is not clean)')
    return 2
  }
  // 零分母第二态（同 verify:volume / check-import-cycles 的口径）：**文件在、内容全空** ≠ 扫过且清白。
  // 一手（第七十五轮，被自家常驻探针抓到）：镜像面把 src 下每个文件写成 0 字节，本件照样打印
  // "scanned 50 tsx files / violations 0" 并 rc=0 —— 那正是"把没量到写成量到了零"的形态。
  const nonBlank = Object.values(sources).filter((x) => String(x).trim() !== '').length
  if (nonBlank === 0) {
    console.log('[a11y-static] UNVERIFIED ' + files + ' 个 .tsx 全为 0 字节 ⇒ 没有对象可判（rc=2，"扫到空文件"不等于"没有违规"）')
    return 2
  }
  const problems = auditSources(sources)
  if (argv.includes('--json')) { console.log(JSON.stringify({ files, problems }, null, 2)); return problems.length ? 1 : 0 }
  const tag = problems.length ? 'GATE-FAIL' : 'GATE-PASS'
  console.log('[a11y-static] ' + tag + ' :: scanned ' + files + ' tsx files | rules 3 | violations ' + problems.length)
  for (const p of problems) console.log('  ' + p.file + ':' + p.line + ' [' + p.rule + '] ' + p.detail)
  return problems.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
