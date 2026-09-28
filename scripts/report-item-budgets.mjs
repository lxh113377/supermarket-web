#!/usr/bin/env node
/**
 * 分项体积预算（第五十二轮 R51-H4 继承项，对标 `GoogleChrome/lighthouse-ci` 的 assertions 形状）
 *
 * 与既有 `check-bundle-size.mjs` 的分工：那件判**首屏合计**（firstLoadJs/Css + largestChunk 三条聚合预算），
 * 本件判**单个 chunk 各自的预算** —— 聚合数不变时单块可以此消彼长（实测 62 件里最大一块占首屏 76%），
 * 这正是"总量没动、结构已变"的盲区。
 *
 * **第一版只出报告、不进 `npm run verify`**（户内规「新指标先量误报率再接闸」）：
 * 别名名为 `report:item-budgets` 而非 `verify:*`，接闸与否由下一轮拿实测误报数决定。
 *
 *   node scripts/report-item-budgets.mjs                     # 真面：读 dist/assets + docs/item-budgets.json
 *   node scripts/report-item-budgets.mjs --dist <dir> --roster <file>
 *   node scripts/report-item-budgets.mjs --selftest          # 判据自证（六条合成面，双向）
 *
 * 三挡退出码（与户内 M4 口径一致，崩溃不得混进任何一挡）：
 *   0 = 已登记项全部在预算内 · 1 = 有项超预算 · 2 = 没有对象可判（产物面/名册面取不到）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'report-item-budgets.mjs')

/** glob → 正则：只支持 `*`（名册面小，引依赖不划算），其余字符按字面量。 */
function toRe(pattern) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`)
}

/**
 * 纯函数：给定产物清单与名册，出四态读数。
 * 不碰磁盘 ⇒ 夹具能用合成面把每条腿都驱动到（真面另有活体腿，两类互不替代）。
 */
export function evaluate({ assets, roster }) {
  const problems = []
  if (!Array.isArray(assets) || assets.length === 0) return { rows: [], rc: 2, why: '产物面为空或没读到 ⇒ 没有对象可判（空集 ≠ 全在预算内）' }
  if (!roster || !Array.isArray(roster.items) || roster.items.length === 0) return { rows: [], rc: 2, why: '名册为空或读不到 ⇒ 无预算可依据（不得退回"看着不大就算过"）' }

  const used = new Set()
  const rows = []
  let judged = 0
  let unjudged = 0
  for (const a of assets) {
    // 一项只认名册里**第一条**命中的规则：允许重叠，但重叠会让"谁给了这个预算"变得不可判定，
    // 所以命中即停，并把重叠在自证行里显式化（下面 rows 会标 `matchedBy`）。
    const hit = roster.items.find((it) => toRe(it.pattern).test(a.name))
    if (!hit) {
      unjudged += 1
      rows.push({ id: a.name, state: 'no-budget', size: a.gz, matchedBy: null })
      continue
    }
    used.add(hit.pattern)
    judged += 1
    const over = a.gz > hit.budget
    rows.push({ id: a.name, state: over ? 'over' : 'ok', size: a.gz, budget: hit.budget,
      headroom: hit.budget - a.gz, matchedBy: hit.pattern })
    if (over) problems.push(`${a.name} 实测 ${a.gz}B > 预算 ${hit.budget}B（超 ${a.gz - hit.budget}B）`)
  }

  // 名册侧反向半边：登记了却一件没匹配上 = 死条目。死豁免比缺豁免更危险（下轮据此以为判过了）。
  const dead = roster.items.filter((it) => !used.has(it.pattern))
  for (const d of dead) {
    problems.push(`名册死条目：\`${d.pattern}\` 在本次产物面里 0 命中 ⇒ 要么产物被改名/删除，要么规则写错`)
  }

  // 恒等式：判过的 + 没登记的 == 产物总件数。不成立说明上面的循环漏了面（例如新增第三种状态）。
  const total = assets.length
  const closure = judged + unjudged === total
  if (!closure) problems.push(`覆盖恒等式不成立：judged(${judged}) + no-budget(${unjudged}) ≠ 总件数(${total})`)
  const rosterClosure = used.size + dead.length === roster.items.length
  if (!rosterClosure) problems.push(`名册恒等式不成立：matched(${used.size}) + dead(${dead.length}) ≠ 登记(${roster.items.length})`)

  const rc = problems.length ? 1 : 0
  return { rows, rc, problems, stats: { total, judged, unjudged, declared: roster.items.length, matched: used.size, dead: dead.length,
    judgedGz: assets.filter((a) => roster.items.some((it) => toRe(it.pattern).test(a.name))).reduce((s, a) => s + a.gz, 0),
    totalGz: assets.reduce((s, a) => s + a.gz, 0) } }
}

export function measureDist(distDir) {
  const dir = join(distDir, 'assets')
  if (!existsSync(dir)) return { assets: null, err: `产物面不存在：${dir} ⇒ 先跑 npx vite build --outDir ${distDir} --emptyOutDir` }
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (!statSync(p).isFile() || !/\.(js|css)$/.test(name)) continue
    out.push({ name, gz: gzipSync(readFileSync(p)).length })
  }
  return { assets: out, err: null }
}

function selftest() {
  const A = (name, gz) => ({ name, gz })
  const cases = [
    ['① 正向：在预算内 ⇒ rc=0 且余量可见',
      { assets: [A('react-vendor-abc.js', 60_000)], roster: { items: [{ pattern: 'react-vendor-*.js', budget: 70_000 }] } },
      (r) => r.rc === 0 && r.rows[0].state === 'ok' && r.rows[0].headroom === 10_000 ],
    ['② 反例：超预算 ⇒ rc=1 且带两侧数',
      { assets: [A('react-vendor-abc.js', 71_000)], roster: { items: [{ pattern: 'react-vendor-*.js', budget: 70_000 }] } },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('71000') && p.includes('超 1000'))],
    ['③ 未登记不判合格：新 chunk 家族 ⇒ no-budget 且被点名（rc 不受它影响，但必须可见）',
      { assets: [A('react-vendor-abc.js', 1), A('brandnew-xyz.js', 5)], roster: { items: [{ pattern: 'react-vendor-*.js', budget: 70_000 }] } },
      (r) => r.rc === 0 && r.stats.unjudged === 1 && r.rows.some((x) => x.state === 'no-budget' && x.id === 'brandnew-xyz.js')],
    ['④ 死条目：登记了却 0 命中 ⇒ 判红（死豁免比缺豁免更危险）',
      { assets: [A('react-vendor-abc.js', 1)], roster: { items: [{ pattern: 'react-vendor-*.js', budget: 70_000 }, { pattern: 'deleted-*.js', budget: 1 }] } },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('deleted-*.js')) && r.stats.dead === 1],
    ['⑤ 零输入：产物面空 ⇒ rc=2，不得印"全在预算内"',
      { assets: [], roster: { items: [{ pattern: 'a-*.js', budget: 1 }] } },
      (r) => r.rc === 2 && /空集/.test(r.why)],
    ['⑥ 零输入：名册空 ⇒ rc=2，不得退回肉眼估量',
      { assets: [A('a.js', 1)], roster: { items: [] } },
      (r) => r.rc === 2 && /名册为空/.test(r.why)],
  ]
  let bad = 0
  for (const [base, input, check] of cases) {
    let ok = false
    let note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${base}${note}`)
  }
  console.log(`[report:item-budgets] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) return selftest()
  const flag = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : dflt
  }
  const distDir = flag('--dist', join(ROOT, 'dist'))
  const rosterPath = flag('--roster', join(ROOT, 'docs', 'item-budgets.json'))

  let roster = null
  let rosterErr = null
  try {
    roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
  } catch (e) {
    rosterErr = `名册读不到或不是合法 JSON：${rosterPath}（${e.code || e.name}）`
  }
  if (rosterErr) {
    console.log(`[report:item-budgets] UNVERIFIED ${rosterErr} ⇒ 不据"没读到"下任何结论`)
    return 2
  }
  const { assets, err } = measureDist(distDir)
  if (err) {
    console.log(`[report:item-budgets] UNVERIFIED ${err}`)
    return 2
  }
  const r = evaluate({ assets, roster })
  if (r.rc === 2) {
    console.log(`[report:item-budgets] UNVERIFIED ${r.why}`)
    return 2
  }
  for (const row of r.rows) {
    if (row.state === 'over') console.log(`FAIL  ${row.id} 实测 ${row.size}B > 预算 ${row.budget}B（超 ${row.size - row.budget}B，规则 \`${row.matchedBy}\`）`)
    else if (row.state === 'ok') console.log(`PASS  ${row.id} 实测 ${row.size}B ≤ 预算 ${row.budget}B（余 ${row.headroom}B）`)
  }
  const nb = r.rows.filter((x) => x.state === 'no-budget').sort((a, b) => b.size - a.size)
  if (nb.length) {
    const kb = (n) => (n / 1024).toFixed(1)
    console.log(`ADVISORY 未登记 ${r.stats.unjudged}/${r.stats.total} 件（合计 ${kb(nb.reduce((s, x) => s + x.size, 0))}KB gz，未判合格）`)
    console.log(`          最大三件：${nb.slice(0, 3).map((x) => `${x.id}=${kb(x.size)}KB`).join(' · ')}`)
  }
  for (const p of r.problems) console.log(`· ${p}`)
  const s = r.stats
  console.log(`[report:item-budgets] verdict=${s.dead ? 'RED' : (r.problems.length ? 'RED' : 'GREEN')} rc=${r.rc}｜`
    + `登记 ${s.declared} 条（匹配 ${s.matched} / 死条目 ${s.dead}）｜产物 ${s.total} 件（判 ${s.judged} / 未登记 ${s.unjudged}）｜`
    + `已判体积 ${kb2(s.judgedGz)}/${kb2(s.totalGz)}KB gz`)
  return r.rc
}
const kb2 = (n) => (n / 1024).toFixed(1)

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
