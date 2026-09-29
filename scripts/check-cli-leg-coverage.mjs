#!/usr/bin/env node
/**
 * CLI 腿覆盖率对账（第五十五轮 R55-H3）
 *
 * 一手起因（第五十四轮 §12·2）：全链跑时 `变异体 M2` 报 `expected '' to contain 'branch=main'`，
 * 单跑 28/28 绿、下一次全链 110/110 绿。真因不是判据变宽 —— 并行负载把
 * `spawnSync(..., { timeout: 20_000 })` 打断 ⇒ `status === null` 且 `stdout === ''`，
 * 而调用点把那个空串当成"判据给出的结论"继续做内容断言。R54-H4 交付了 `assertCliRan`，
 * 但它只接进了少数文件 ⇒ 同一条失效路在其他测试里仍然会以"内容断言失败"的假面出现。
 *
 * 本件不新增第二条守卫，只把**还差多少件没接**从感觉变成数字：
 *   ① 分母按 AST 取（`@babel/parser`），不按 grep 计数 —— 本轮先用量文本检测器勘察过一次，
 *      它对 `function probe(script, { cwd = REPO } = {}) {}` 这类带解构的签名整片失明
 *      （漏判 cliEntrypoints 的 24 个位点），所以这里只信解析器；
 *   ② 风险位点 = **options 字面量里带 `timeout`** 的 spawn 调用。不带 timeout 的 spawnSync
 *      只会阻塞到被 runner 杀，产不出 `status === null`，把它算进分母等于虚报欠账；
 *   ③ 恒等式 `sites_total = sites_with_timeout + sites_without_timeout` 不成立即判红（漏面当场暴露）；
 *   ④ 欠账件数与 `docs/cli-legs.json` 的 `unguardedMax` 对账，**只准降不准升**；
 *      缺失该字段 ⇒ UNVERIFIED（把"没人立过上限"读成"上限无穷、自动通过"是户内 G14 的反面）。
 *
 * 用法：node scripts/check-cli-leg-coverage.mjs [--selftest] [--json] [--dir <tests>] [--roster <file>]
 * 退出码：0=在阈内且恒等式闭合 / 1=超阈或恒等式不闭合或主张与产物不符 / 2=输入面不满足（没 tests、没上限、解析器缺位）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-cli-leg-coverage.mjs')
export const DEFAULT_TESTS = join(ROOT, 'tests')
export const DEFAULT_ROSTER = join(ROOT, 'docs', 'cli-legs.json')

const SPAWN_NAMES = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'fork'])
const GUARD_NAMES = new Set(['assertCliRan', 'requireCliRan'])

/** 递归收集 .test.js（目录面与 runner 的采集面同源，不靠 git 跟踪状态）。 */
export function listTestFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (n.endsWith('.test.js')) out.push(p)
    }
  }
  if (!existsSync(dir)) return { files: [], err: `tests 目录不存在：${dir}` }
  walk(dir)
  return { files: out.sort(), err: null }
}

/** 只取被调名的末段：`child.spawnSync(...)` 与 `spawnSync(...)` 都算。 */
function calleeName(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && node.property) return node.property.name || node.property.value
  return null
}

/** options 实参里是否出现 `timeout` 键（对象字面量第三/四位，或属性名含 timeout）。 */
function hasTimeoutOption(callNode) {
  const args = callNode.arguments || []
  for (const a of args) {
    if (a && a.type === 'ObjectExpression') {
      if (a.properties.some((p) => p.type === 'ObjectProperty'
        && ((p.key && (p.key.name === 'timeout' || p.key.value === 'timeout'))))) return true
    }
    // spawn(cmd, args, {timeout}) —— 第三个参数；execFile 同位
  }
  return false
}

/**
 * 纯函数：给定「文件名 → 源码」面与上限，出读数。不碰磁盘 ⇒ 夹具能驱动每一条腿。
 * 解析失败的文件单独计数并**踢出分母、点名原因**（不得当成"没有裸腿"）。
 */
export function evaluate({ sources, unguardedMax, parseFn }) {
  const problems = []
  const parse = parseFn || require('@babel/parser').parse
  const files = Object.keys(sources).sort()
  if (files.length === 0) return { rc: 2, why: '采集面为空 ⇒ 没有对象可判（空集 ≠ 全接完了）', stats: null }
  if (typeof unguardedMax !== 'number') return { rc: 2, why: '上限没读到 ⇒ 不据"没人立过上限"判通过', stats: null }

  let sitesTotal = 0, sitesTimeout = 0, sitesNoTimeout = 0
  const debt = [], guarded = [], unparsed = []
  for (const f of files) {
    let ast
    try {
      ast = parse(sources[f], { sourceType: 'module', plugins: [] })
    } catch (e) {
      unparsed.push(`${f}（${e.message.split('\n')[0]}）`)
      continue
    }
    let hasGuard = false
    const local = { timeout: 0, plain: 0 }
    const visit = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'CallExpression') {
        const cn = calleeName(n.callee)
        if (cn && SPAWN_NAMES.has(cn)) {
          sitesTotal += 1
          if (hasTimeoutOption(n)) { local.timeout += 1; sitesTimeout += 1 }
          else { local.plain += 1; sitesNoTimeout += 1 }
        }
        if (cn && GUARD_NAMES.has(cn)) hasGuard = true
      }
      // import 进来的守卫也算（调用点可能把守卫放在被调函数里）
      if (n.type === 'ImportSpecifier' && n.imported && GUARD_NAMES.has(n.imported.name || n.imported.value)) hasGuard = true
      for (const [k, v] of Object.entries(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    visit(ast)
    if (hasGuard) guarded.push(f)
    else if (local.timeout > 0) debt.push({ file: f, timeoutSites: local.timeout, plainSites: local.plain })
  }
  const identityOk = sitesTotal === sitesTimeout + sitesNoTimeout
  if (!identityOk) problems.push(`恒等式不闭合：sites_total=${sitesTotal} ≠ with_timeout=${sitesTimeout} + without=${sitesNoTimeout}`)
  if (unparsed.length) problems.push(`解析失败被踢出分母（不得读成"没有裸腿"）：${unparsed.join(', ')}`)
  if (debt.length > unguardedMax) {
    problems.push(`未接守卫且含 timeout 位点的文件 ${debt.length} 件 > 上限 ${unguardedMax} ⇒ 只准降不准升，处置＝把接守卫当成本轮的一部分，或本轮不动但禁调高上限`)
  }

  const rc = !identityOk || unparsed.length || debt.length > unguardedMax ? 1 : 0
  return {
    rc,
    stats: {
      files: files.length, sitesTotal, sitesTimeout, sitesNoTimeout,
      debt: debt.length, guarded: guarded.length, unparsed: unparsed.length, cap: unguardedMax,
    },
    guardedList: guarded.sort(),
    debtList: debt.sort((a, b) => b.timeoutSites - a.timeoutSites),
    problems,
  }
}

function selftest() {
  const cases = [
    ['① 正向：唯一一件含 timeout 裸腿、上限 1 ⇒ rc=0 且件数点名',
      { sources: { 'a.test.js': `import { spawnSync } from 'node:child_process'\nconst r = spawnSync('x', [], { timeout: 1000 })\nexport default r\n` }, unguardedMax: 1 },
      (x) => x.rc === 0 && x.stats.debt === 1 && x.debtList[0].file === 'a.test.js'],
    ['② 反例：同面但上限 0 ⇒ rc=1 并给出处置',
      { sources: { 'a.test.js': `import { spawnSync } from 'node:child_process'\nconst r = spawnSync('x', [], { timeout: 1000 })\nexport default r\n` }, unguardedMax: 0 },
      (x) => x.rc === 1 && x.problems.some((p) => p.includes('1 件 > 上限 0'))],
    ['③ 已接守卫 ⇒ 不算欠账（守卫名与 import 两条路都要认）',
      { sources: { 'a.test.js': `import { spawnSync } from 'node:child_process'\nimport { assertCliRan } from './helpers/cliLeg.js'\nconst r = assertCliRan(spawnSync('x', [], { timeout: 1000 }))\nexport default r\n` }, unguardedMax: 0 },
      (x) => x.rc === 0 && x.stats.debt === 0 && x.stats.guarded === 1],
    ['④ 无 timeout 的 spawn ⇒ 进总量不进欠账（分母不虚报）',
      { sources: { 'a.test.js': `import { spawnSync } from 'node:child_process'\nconst r = spawnSync('x', [])\nexport default r\n` }, unguardedMax: 0 },
      (x) => x.rc === 0 && x.stats.sitesTotal === 1 && x.stats.sitesTimeout === 0 && x.stats.debt === 0],
    ['⑤ 零输入：采集面空 ⇒ rc=2，不得印"全接完了"',
      { sources: {}, unguardedMax: 0 },
      (x) => x.rc === 2 && /没有对象可判/.test(x.why)],
    ['⑥ 零输入：上限缺失 ⇒ rc=2，不得把"没立过上限"当无穷',
      { sources: { 'a.test.js': `const r = 1\n` }, unguardedMax: null },
      (x) => x.rc === 2 && /上限/.test(x.why)],
    ['⑦ 变异体（恒绿守卫）：解析崩的文件必须踢出分母并点名，不得静默算过',
      { sources: { 'a.test.js': `const x = ((( 坏语法\n` }, unguardedMax: 5 },
      (x) => x.rc === 1 && x.stats.files === 1 && x.stats.unparsed === 1 && x.problems.some((p) => p.includes('解析失败'))],
    ['⑧ 恒等式腿：三站点里有 timeout 的 1 个、无的 2 个 ⇒ 1+2==3 才绿',
      { sources: { 'a.test.js': `import { spawnSync } from 'node:child_process'\nspawnSync('x', [], { timeout: 1 })\nspawnSync('y', [])\nspawnSync('z', [])\n` }, unguardedMax: 1 },
      (x) => x.rc === 0 && x.stats.sitesTotal === 3 && x.stats.sitesTimeout === 1 && x.stats.sitesNoTimeout === 2],
  ]
  let bad = 0
  for (const [name, input, check] of cases) {
    let ok = false, note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note}`)
  }
  console.log(`[verify:cli-legs] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const flag = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : dflt
  }
  const testsDir = flag('--dir', DEFAULT_TESTS)
  const rosterPath = flag('--roster', DEFAULT_ROSTER)

  const { files, err } = listTestFiles(testsDir)
  if (err) { console.log(`[verify:cli-legs] UNVERIFIED ${err} ⇒ 不据"没扫到"下结论`); return 2 }

  let unguardedMax = null, capNote = ''
  try {
    const j = JSON.parse(readFileSync(rosterPath, 'utf8'))
    unguardedMax = j.unguardedMax
    capNote = j.capNote || ''
  } catch (e) {
    console.log(`[verify:cli-legs] UNVERIFIED 上限册读不到或非法 JSON：${rosterPath}（${e.code || e.name}）`)
    return 2
  }

  let parseFn
  try { require.resolve('@babel/parser') } catch { parseFn = () => { throw new Error('ERR_NO_PARSER') } }
  const sources = {}
  for (const f of files) sources[relative(ROOT, f).split(sep).join('/')] = readFileSync(f, 'utf8')

  const r = evaluate({ sources, unguardedMax, parseFn })
  if (argv.includes('--json')) {
    // JSON 面给测试做双向对账用（名单不手抄 ⇒ 判据与测试读同一次取数）。
    // 崩溃/没量到时也出 JSON，但 verdict 必须写 UNVERIFIED —— 让调用方无法把"没数据"读成"零欠账"。
    console.log(JSON.stringify({
      verdict: r.rc === 2 ? 'UNVERIFIED' : (r.rc === 1 ? 'RED' : 'GREEN'),
      rc: r.rc, why: r.why || null, stats: r.stats || null,
      guarded: r.guardedList || [], debt: (r.debtList || []).map((d) => d.file), problems: r.problems || [],
    }))
    return r.rc
  }
  if (r.rc === 2) { console.log(`[verify:cli-legs] UNVERIFIED ${r.why}`); return 2 }
  for (const p of r.problems) console.log(`· ${p}`)
  if (r.debtList.length) {
    console.log(`ADVISORY 未接守卫且带 timeout 的文件 ${r.stats.debt} 件（按位点数降序，最多 ${r.debtList[0].timeoutSites} 处）：`)
    for (const d of r.debtList) console.log(`  ${d.file}  timeout位点 ${d.timeoutSites} / 无 timeout ${d.plainSites}`)
  }
  const s = r.stats
  console.log(`[verify:cli-legs] verdict=${r.rc ? 'RED' : 'GREEN'} rc=${r.rc}｜采集 ${s.files} 个 .test.js（解析失败 ${s.unparsed}）｜`
    + `spawn 位点 ${s.sitesTotal}（带 timeout ${s.sitesTimeout} / 不带 ${s.sitesNoTimeout}）｜`
    + `已接守卫 ${s.guarded}｜欠账 ${s.debt}/${s.cap}（余 ${s.cap - s.debt}）`)
  if (capNote) console.log(`      上限依据：${capNote}`)
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
