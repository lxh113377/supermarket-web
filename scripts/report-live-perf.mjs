#!/usr/bin/env node
/**
 * 现网运行时性能读数腿（第五十五轮 R55-H1）
 *
 * 一手起因：这一维连续五轮都写在「未观测」里，每轮拿同一句「无可比口径」结案。
 * 户内 M5⑫ 把这种写法点名成失效形态（disclaimer-as-measurement）——边界声明只说明"比不了"，
 * 不说明这一维里发生了什么。本轮真跑了一次，结论是**跑得动**：
 *   `npx lighthouse <url> --only-categories=performance --output=json --output-path=...`
 *   用 Edge 作 Chromium 载体（本机无 Chrome：`command -v lighthouse` 为 NO、
 *   `npx --no-install lighthouse --version` = 13.5.0，CHROME_PATH 指 msedge.exe）。
 * 所以本件不是"又一个免责声明"，而是把那次测量固化成一条**每次都能复算**的腿。
 *
 * 它判什么、不判什么（先划清，免得下一轮又把它当阈值闸）：
 *   ✅ 判：产物面完整性（样本可解析、有 `first-contentful-paint`、无 runtimeError、
 *          同一标签页的最终 URL 一致、样本数 ≥ 名册 `minSamples`）
 *   ✅ 判：分布形状（中位数 / 极值 / 倍差），并把倍差显式印出来 —— 本轮实测 speed-index
 *          在同一台机器同一站点上 4,580B→20,707B（**4.5 倍**），单样本会把这件事完全藏掉
 *   ❌ 不判：达标线。立阈值要两侧边界值实测依据（户内 M4），本轮只有同一天两次采样的分布，
 *          既没有跨日基线也不知道"什么样算坏"。登记到 R56 再立。
 *   ❌ 不进 CI：判据不联网（联网腿在 runner 上不可复现，且户内禁把线上可用性混进门禁结论）。
 *          取数在人这一侧跑，本件只读产物。
 *
 * 用法：node scripts/report-live-perf.mjs [--dir .lighthouse] [--roster docs/live-perf.json] [--selftest] [--json]
 * 退出码：0=产物面完整且在名册要求的样本数之上 / 1=产物与主张不符（缺 FCP、runtimeError、URL 分歧、样本不足）/ 2=没有对象可判（目录不存在或零样本）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'report-live-perf.mjs')
export const DEFAULT_DIR = join(ROOT, '.lighthouse')
export const DEFAULT_ROSTER = join(ROOT, 'docs', 'live-perf.json')

export const METRICS = [
  'first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift',
  'total-blocking-time', 'speed-index', 'server-response-time',
]

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round = (n, d = 1) => (n == null ? null : Number(n.toFixed(d)))

/**
 * 纯函数：给定「文件名 → 已解析的 LH 报告」面与名册，出读数。
 * 不碰磁盘也不联网 ⇒ 夹具能驱动每条腿（真面另有活体腿，两类互不替代）。
 */
export function evaluate({ samples, roster }) {
  const problems = []
  const notes = []
  const names = Object.keys(samples).sort()
  if (names.length === 0) return { rc: 2, why: '样本面为空 ⇒ 没有对象可判（空集 ≠ 现网很快）', groups: [], notes }
  if (!roster || !Array.isArray(roster.pages) || roster.pages.length === 0) {
    return { rc: 2, why: '名册为空或读不到 ⇒ 没有"该量哪些页面"的依据（不得退回"有几个算几个"）', groups: [], notes }
  }

  const groups = new Map()
  let unreadable = 0
  for (const n of names) {
    const tag = n.split('-s')[0]
    const s = samples[n]
    if (!s || typeof s !== 'object') { unreadable += 1; problems.push(`${n}：不是合法的 Lighthouse JSON ⇒ 该样本踢出统计并点名`); continue }
    if (s.__parseError) { unreadable += 1; problems.push(`${n}：JSON 解析失败（${s.__parseError}）⇒ 踢出统计，不并入任何分布`); continue }
    const page = roster.pages.find((p) => p.tag === tag)
    if (!page) { problems.push(`${n}：标签 \`${tag}\` 不在名册里 ⇒ 要么补名册条目，要么删掉这个样本；不得自动并入`); continue }
    if (s.runtimeError) { problems.push(`${n}：runtimeError=${s.runtimeError.code || '?'} ⇒ 这是一次**没测成**的采样，不得折进基线`); continue }
    if (!s.audits || !s.audits['first-contentful-paint']) { problems.push(`${n}：声称是 run 产物却缺 \`first-contentful-paint\` ⇒ 产物与主张不符，不判达标也不判"没问题"`); continue }
    const url = s.finalDisplayedUrl || s.finalUrl || ''
    if (page.expectUrlIncludes && !url.includes(page.expectUrlIncludes)) {
      problems.push(`${n}：最终 URL \`${url}\` 与名册期望 \`${page.expectUrlIncludes}\` 不符 ⇒ 测的不是那一页（重定向/404 都会在这里现形）`)
    }
    if (!groups.has(tag)) groups.set(tag, { tag, url, rows: [], samples: [], fetchTimes: [], formFactors: new Set() })
    const g = groups.get(tag)
    g.samples.push({ name: n })
    g.fetchTimes.push(s.fetchTime || '')
    g.formFactors.add((s.configSettings && s.configSettings.formFactor) || '?')
    const row = { name: n }
    for (const m of METRICS) row[m] = num(s.audits[m] && s.audits[m].numericValue)
    g.rows.push(row)
    if (g.url !== url && !g.url) g.url = url
  }

  const out = []
  for (const [, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const page = roster.pages.find((p) => p.tag === g.tag) || { minSamples: 1 }
    if (g.formFactors.size > 1) problems.push(`${g.tag}：同一批样本混了视口形态 ${[...g.formFactors].join('/')} ⇒ 分布不可比，须分档重跑`)
    if (g.samples.length < (page.minSamples || 1)) problems.push(`${g.tag}：样本 ${g.samples.length} < 名册要求 ${page.minSamples} ⇒ 不足一次分布，只列原始值不印中位数`)
    const metrics = []
    for (const m of METRICS) {
      const vals = g.rows.map((r) => r[m]).filter((v) => v !== null)
      if (vals.length === 0) { problems.push(`${g.tag}/${m}：所有样本都取不到该指标 ⇒ 该格 UNVERIFIED`); continue }
      const mn = Math.min(...vals), mx = Math.max(...vals)
      const ratio = mn > 0 ? mx / mn : null
      metrics.push({ metric: m, n: vals.length, median: round(median(vals), m === 'cumulative-layout-shift' ? 3 : 1), min: round(mn, 3), max: round(mx, 3), spread: ratio == null ? null : round(ratio, 2) })
      if (ratio != null && ratio >= 2) notes.push(`${g.tag}/${m}：同机同站倍差 ${ratio.toFixed(2)}×（${round(mn, 1)} → ${round(mx, 1)}）⇒ **单样本不足以定基线**`)
      if (ratio == null && mx > 0 && mn === 0) notes.push(`${g.tag}/${m}：下界为 0（如空闲页 TBT），倍差不定义，只报极值`)
    }
    out.push({ tag: g.tag, url: g.url, n: g.samples.length, fetchTimes: [...new Set(g.fetchTimes)].sort(), formFactors: [...g.formFactors].join('/'), metrics })
  }
  const rc = problems.length ? 1 : 0
  return { rc, groups: out, problems, notes, unreadable }
}

function fmtRow(g) {
  return g.metrics.map((m) => `    ${m.metric.padEnd(24)} 中位 ${String(m.median).padStart(8)}｜[${m.min} .. ${m.max}]｜倍差 ${m.spread == null ? 'n/a' : m.spread + '×'}｜样本 ${m.n}`).join('\n')
}

function selftest() {
  const mk = (over = {}) => ({
    finalDisplayedUrl: 'https://supermarket-web.pages.dev/',
    fetchTime: '2026-09-29T06:49:23.204Z',
    configSettings: { formFactor: 'mobile' },
    audits: {
      'first-contentful-paint': { numericValue: 1500 },
      'largest-contentful-paint': { numericValue: 1900 },
      'cumulative-layout-shift': { numericValue: 0 },
      'total-blocking-time': { numericValue: 200 },
      'speed-index': { numericValue: 4500 },
      'server-response-time': { numericValue: 230 },
    },
    ...over,
  })
  const roster = { pages: [{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }] }
  const cases = [
    ['① 正向：两样本齐全 ⇒ rc=0 且印中位数与倍差',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk({ audits: { ...mk().audits, 'speed-index': { numericValue: 20000 } } }) }, roster },
      (r) => r.rc === 0 && r.groups[0].n === 2 && r.groups[0].metrics.find((m) => m.metric === 'speed-index').spread === 4.44
        && r.notes.some((x) => x.includes('倍差 4.44×'))],
    ['② 反例：样本数低于名册要求 ⇒ rc=1 并点名（不足一次分布不许印"稳定"）',
      { samples: { 'admin-s1.json': mk() }, roster },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('样本 1 < 名册要求 2'))],
    ['③ 反例：缺 first-contentful-paint ⇒ 产物与主张不符，判红而不是当"没有该指标"',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': (() => { const x = mk(); delete x.audits['first-contentful-paint']; return x })() }, roster },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('缺 `first-contentful-paint`'))],
    ['④ 反例：runtimeError 的样本不得折进基线（一次没测成 ≠ 一个慢读数）',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk({ runtimeError: { code: 'NETWORK_ERROR' } }) }, roster },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('runtimeError=NETWORK_ERROR')) && r.groups[0].n === 1],
    ['⑤ 反例：URL 与名册不符 ⇒ 测错了页面必须现形（重定向/404 全靠这条）',
      { samples: { 'admin-s1.json': mk({ finalDisplayedUrl: 'https://supermarket-web.pages.dev/login' }), 'admin-s2.json': mk({ finalDisplayedUrl: 'https://example.invalid/' }) }, roster: { pages: [{ tag: 'admin', expectUrlIncludes: 'pages.dev/__', minSamples: 1 }] } },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('与名册期望'))],
    ['⑥ 反例：混视口形态 ⇒ 分布不可比要具名',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk({ configSettings: { formFactor: 'desktop' } }) }, roster },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('混了视口形态 mobile/desktop'))],
    ['⑦ 零输入：样本面空 ⇒ rc=2，不得印"现网很快"',
      { samples: {}, roster },
      (r) => r.rc === 2 && /没有对象可判/.test(r.why)],
    ['⑧ 零输入：名册空 ⇒ rc=2，不得退回"有几个算几个"',
      { samples: { 'admin-s1.json': mk() }, roster: { pages: [] } },
      (r) => r.rc === 2 && /名册为空/.test(r.why)],
    ['⑨ 反例：标签不在名册 ⇒ 不许自动并入（死豁免比缺豁免危险）',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'stray-s1.json': mk() }, roster },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('不在名册里'))],
    ['⑩ 变异体（恒绿守卫）：TBT 下界为 0 时倍差不得算成 0 或 Infinity，只能印 n/a + 注记',
      { samples: { 'admin-s1.json': mk({ audits: { ...mk().audits, 'total-blocking-time': { numericValue: 0 } } }), 'admin-s2.json': mk({ audits: { ...mk().audits, 'total-blocking-time': { numericValue: 205 } } }) }, roster },
      (r) => r.rc === 0 && r.groups[0].metrics.find((m) => m.metric === 'total-blocking-time').spread === null
        && r.notes.some((x) => x.includes('total-blocking-time：下界为 0'))],
  ]
  let bad = 0
  for (const [name, input, check] of cases) {
    let ok = false, note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note}`)
  }
  console.log(`[report:live-perf] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const flag = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : dflt
  }
  const dir = flag('--dir', DEFAULT_DIR)
  const rosterPath = flag('--roster', DEFAULT_ROSTER)

  let roster = null
  try { roster = JSON.parse(readFileSync(rosterPath, 'utf8')) } catch (e) {
    console.log(`[report:live-perf] UNVERIFIED 名册读不到或不是合法 JSON：${rosterPath}（${e.code || e.name}）`)
    return 2
  }
  if (!existsSync(dir)) {
    console.log(`[report:live-perf] UNVERIFIED 样本目录不存在：${dir} ⇒ 本轮**没测**，不得与"测了且快"共用沉默态。取证命令：见本文件头注释`)
    return 2
  }
  const all = readdirSync(dir).filter((f) => f.endsWith('.json'))
  // 只认 `<tag>-s<n>.json` 这一种命名（名册/日志/顺手放进来的别的 json 都不算样本）。
  // 一手教训来自本件夹具的第一次真跑：名册 `roster.json` 与被测样本同目录，于是它被当成
  // "标签不在名册里"判红 —— 判据把**自己的输入**当成了被审对象。跳过可以，但必须点名，
  // 不然下一轮加个 `summary.json` 就静默少算一份样本（户内「0 命中要先证输入非空」同族）。
  const files = all.filter((f) => /-s\d+\.json$/.test(f))
  const skipped = all.filter((f) => !/-s\d+\.json$/.test(f))
  if (files.length === 0) {
    console.log(`[report:live-perf] UNVERIFIED ${dir} 里没有符合 \`<tag>-s<n>.json\` 的样本（该目录 .json 共 ${all.length} 个：${skipped.join(', ') || '无'}）⇒ 本轮**没测**，不得与"测了且快"共用沉默态。取证命令：见本文件头注释`)
    return 2
  }
  const samples = {}
  for (const f of files) {
    try { samples[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch (e) { samples[f] = { __parseError: e.message.split('\n')[0] } }
  }
  const r = evaluate({ samples, roster })
  if (r.rc === 2) { console.log(`[report:live-perf] UNVERIFIED ${r.why}`); return 2 }
  for (const g of r.groups) {
    console.log(`GROUP ${g.tag}｜${g.url}｜样本 ${g.n} 份｜formFactor=${g.formFactors}｜fetchTime ${g.fetchTimes.join(' ~ ')}`)
    console.log(fmtRow(g))
  }
  for (const n of r.notes) console.log(`NOTE  ${n}`)
  if (skipped.length) console.log(`NOTE  ${dir} 里 ${skipped.length} 个 .json 不是样本命名（\`<tag>-s<n>.json\`），已跳过并点名：${skipped.join(', ')}`)
  for (const p of r.problems) console.log(`· ${p}`)
  const s = r.groups.reduce((a, g) => a + g.n, 0)
  console.log(`[report:live-perf] verdict=${r.rc ? 'RED' : 'GREEN'} rc=${r.rc}｜名册 ${roster.pages.length} 页｜入统计样本 ${s}/${files.length} 份｜达标线=未立（见文件头，R56 立）`)
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
