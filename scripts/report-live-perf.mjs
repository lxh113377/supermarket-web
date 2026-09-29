#!/usr/bin/env node
/**
 * 现网运行时性能读数腿（第五十五轮 R55-H1 立，第五十六轮 R56-H1 加"批次"与"立线条件"）
 *
 * 一手起因（R55）：这一维连续五轮都写在「未观测」里，每轮拿同一句「无可比口径」结案。
 * 户内 M5⑫ 把这种写法点名成失效形态（disclaimer-as-measurement）——边界声明只说明"比不了"，
 * 不说明这一维里发生了什么。R55 真跑了一次，结论是**跑得动**：
 *   `npx lighthouse <url> --only-categories=performance --output=json --output-path=...`
 *   用 Edge 作 Chromium 载体（本机无 Chrome：`command -v lighthouse` 为 NO、
 *   `npx --no-install lighthouse --version` = 13.5.0，CHROME_PATH 指 msedge.exe）。
 *
 * R56 一手起因（本轮）：R55 把"立阈值"挂给 R56，条件是"跨日再采一次"。本轮真采了第二批
 * （`.lighthouse/<tag>-d2-s1..3.json`，09:55–09:58Z，距首批 3 小时），得到两条 R55 没预料到的东西：
 *   ① **同日两批的中位数差就有 28–41%**（admin FCP 1,513 → 1,935、LCP 1,953 → 2,762）
 *      ⇒ "跨日"根本不是立线的充分条件，先把"两批差几天"这件事交给判据自己算，比让人记得更可靠；
 *   ② 顾客端 3 份全部 `runtimeError=NO_FCP` + `finalDisplayedUrl=about:blank`，同刻
 *      `curl https://lxh113377.github.io/` = **000（20s 超时）** 而 pages.dev=200
 *      ⇒ 这是"没采到"不是"采到且坏"。两者若共用一个红字，下一轮就无法区分"站点坏了"与"本机到该域名不通"
 *      （户内「盲区不是零」「不可达证据须带域名状态码」）。
 * 所以本件的立线条件不是散文，是一段可复算的判决：缺哪一条、差几天，由判据当场印出来。
 *
 * 它判什么、不判什么（先划清，免得下一轮又把它当阈值闸）：
 *   ✅ 判：产物面完整性（样本可解析、有 `first-contentful-paint`、无 runtimeError、
 *          同一标签页的最终 URL 一致、每批样本数 ≥ 名册 `minSamples`）
 *   ✅ 判：分布形状（中位数 / 极值 / 倍差），并**按 页面×批次 分组**（跨批次混在一起算中位数会把手法漂移洗成"稳定"）
 *   ✅ 判：立线条件成立与否（两侧分布 + 日期差），但**不立线**——`thresholds` 仍由人写进名册
 *   ❌ 不判：达标线本身。立阈值要两侧边界值实测依据（户内 M4：阈值必须能失败）
 *   ❌ 不进 CI：判据不联网（联网腿在 runner 上不可复现）。取数由 `scripts/collect-live-perf.mjs` 在人这一侧跑。
 *
 * 用法：node scripts/report-live-perf.mjs [--dir .lighthouse] [--roster docs/live-perf.json] [--selftest] [--json]
 * 退出码：0=产物面完整且每批在名册样本数之上 / 1=产物与主张不符（缺 FCP、runtimeError、URL 分歧、样本不足）
 *        / 2=没有对象可判（目录不存在或零样本）
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

/**
 * 网络类 runtimeError —— 这些是"这一次没采到"，与"产物声称是 run 却缺件"是两类判决。
 * 一手：本轮顾客端 3 份 NO_FCP 与同刻 curl 000 同时发生；把它们和"缺 first-contentful-paint"
 * 混成一类，下一轮就分不出"站点退化"和"本机到那个域名不通"。
 */
export const NETWORK_ERROR_CODES = new Set([
  'NO_FCP', 'NETWORK_ERROR', 'NAVIGATION_ERROR', 'PAGE_HUNG', 'TIMEOUT',
  'MISSING_REQUIRED_TRACE_ARTIFACTS', 'PROMPT_TIME_EXCEED_300',
])

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round = (n, d = 1) => (n == null ? null : Number(n.toFixed(d)))

/**
 * 文件名 → {page, batch, seq}。语法 `<page>[-<batch>]-s<seq>.json`。
 * page 用**名册里最长匹配的 tag**（名册是 tag 的唯一权威，不做正则猜测）；
 * 剩下那段是 batch；整段等于某个 tag 时 batch 为空串（首批，即 R55 那批 `admin-s1.json` 的形态）。
 * 约束（沿用名册 tagDerivation）：page 与 batch 段内都不得出现 `-s<数字>`，否则切分有歧义。
 * 匹配不到任何 tag 时原样返回整段，交给下游按"野标签"点名——**不得自动并入**。
 */
export function parseName(name, pages) {
  const m = /^(.*)-s(\d+)\.json$/.exec(name)
  if (!m) return null
  const stem = m[1]
  const seq = Number(m[2])
  if (stem === undefined) return null
  let best = null
  for (const p of pages || []) {
    const tag = p && p.tag
    if (!tag) continue
    if (stem === tag) return { page: tag, batch: '', seq }
    if (stem.startsWith(`${tag}-`) && (!best || tag.length > best.tag.length)) best = p
  }
  if (best) return { page: best.tag, batch: stem.slice(best.tag.length + 1), seq }
  return { page: stem, batch: '', seq }
}

/** fetchTime('2026-09-29T09:55:34.216Z') → '2026-09-29'；取不到返回 '' */
const dayOf = (t) => (/^\d{4}-\d{2}-\d{2}/.test(String(t || '')) ? String(t).slice(0, 10) : '')
const dayGap = (a, b) => {
  if (!a || !b) return null
  const ms = Math.abs(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`))
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/**
 * 纯函数：给定「文件名 → 已解析的 LH 报告」面与名册，出读数。
 * 不碰磁盘也不联网 ⇒ 夹具能驱动每条腿（真面另有活体腿，两类互不替代）。
 */
export function evaluate({ samples, roster, now }) {
  const problems = []
  const notes = []
  const names = Object.keys(samples).sort()
  if (names.length === 0) return { rc: 2, why: '样本面为空 ⇒ 没有对象可判（空集 ≠ 现网很快）', groups: [], notes, batches: [], budget: null }
  if (!roster || !Array.isArray(roster.pages) || roster.pages.length === 0) {
    return { rc: 2, why: '名册为空或读不到 ⇒ 没有"该量哪些页面"的依据（不得退回"有几个算几个"）', groups: [], notes, batches: [], budget: null }
  }

  const groups = new Map()
  // 逐样本三态计数（kept / notMeasured / artifact）。**不按组回推**：回推要依赖"组还在"，
  // 而本轮第一版就是因为整批被剔的组没进 groups，让门面行算出 `产物不符 -3` 这种物理上不可能的数。
  // 恒等式 kept + notMeasured + artifact === 样本文件数，由门面行自检并印 ✓/✗。
  const stats = { kept: 0, notMeasured: 0, artifact: 0 }
  const ensure = (page, batch) => {
    const key = `${page}/${batch || 'base'}`
    if (!groups.has(key)) {
      groups.set(key, { key, page, batch, url: '', rows: [], samples: [], fetchTimes: [], formFactors: new Set(), excluded: 0 })
    }
    return groups.get(key)
  }

  for (const n of names) {
    const s = samples[n]
    if (!s || typeof s !== 'object') { stats.artifact += 1; problems.push(`${n}：不是合法的 Lighthouse JSON ⇒ 该样本踢出统计并点名`); continue }
    if (s.__parseError) { stats.artifact += 1; problems.push(`${n}：JSON 解析失败（${s.__parseError}）⇒ 踢出统计，不并入任何分布`); continue }
    const parsed = parseName(n, roster.pages)
    const page = parsed ? roster.pages.find((p) => p.tag === parsed.page) : null
    if (!page) {
      stats.artifact += 1
      problems.push(`${n}：标签 \`${parsed ? parsed.page : '?'}\` 不在名册里 ⇒ 要么补名册条目，要么删掉这个样本；不得自动并入`)
      continue
    }
    const g = ensure(page.tag, parsed.batch)
    const err = s.runtimeError
    if (err) {
      const code = err.code || '?'
      const url0 = s.finalDisplayedUrl || s.finalUrl || ''
      g.excluded += 1
      // "未采到"与"产物不符"分列：判决不同，处置也不同（前者换网络重采，后者查采集器/名册）
      if (NETWORK_ERROR_CODES.has(code) && (!url0 || url0 === 'about:blank')) {
        stats.notMeasured += 1
        problems.push(`${n}：runtimeError=${code} 且最终 URL 为 \`${url0 || '(空)'}\` ⇒ **这一批没采到**（网络类，不是"采到且慢"），不得折进基线`)
      } else {
        stats.artifact += 1
        problems.push(`${n}：runtimeError=${code} ⇒ 这是一次**没测成**的采样，不得折进基线`)
      }
      continue
    }
    if (!s.audits || !s.audits['first-contentful-paint']) {
      g.excluded += 1; stats.artifact += 1
      problems.push(`${n}：声称是 run 产物却缺 \`first-contentful-paint\` ⇒ 产物与主张不符，不判达标也不判"没问题"`)
      continue
    }
    const url = s.finalDisplayedUrl || s.finalUrl || ''
    if (page.expectUrlIncludes && !url.includes(page.expectUrlIncludes)) {
      problems.push(`${n}：最终 URL \`${url}\` 与名册期望 \`${page.expectUrlIncludes}\` 不符 ⇒ 测的不是那一页（重定向/404 都会在这里现形）`)
    }
    stats.kept += 1
    g.url = g.url || url
    g.samples.push({ name: n })
    g.fetchTimes.push(s.fetchTime || '')
    g.formFactors.add((s.configSettings && s.configSettings.formFactor) || '?')
    const row = { name: n }
    for (const m of METRICS) row[m] = num(s.audits[m] && s.audits[m].numericValue)
    g.rows.push(row)
  }

  const out = []
  for (const [, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const page = roster.pages.find((p) => p.tag === g.page) || { minSamples: 1 }
    if (g.formFactors.size > 1) problems.push(`${g.key}：同一批样本混了视口形态 ${[...g.formFactors].join('/')} ⇒ 分布不可比，须分档重跑`)
    if (g.samples.length < (page.minSamples || 1)) {
      problems.push(`${g.key}：样本 ${g.samples.length} < 名册要求 ${page.minSamples} ⇒ 不足一次分布，只列原始值不印中位数`)
    }
    const metrics = []
    // 整批一份没采到时，逐指标各印一行 UNVERIFIED 是 6 倍噪音；只补一条具名总账。
    // **组仍然要进 out** —— 否则"这一批全没测到"从输出里消失，等于把盲区洗成"没这一批"。
    if (!g.rows.length && g.excluded) problems.push(`${g.key}：该批 ${g.excluded} 份全部被剔 ⇒ 六个指标格一并记 UNVERIFIED，不逐格刷屏`)
    for (const m of g.rows.length ? METRICS : []) {
      const vals = g.rows.map((r) => r[m]).filter((v) => v !== null)
      if (vals.length === 0) { problems.push(`${g.key}/${m}：所有样本都取不到该指标 ⇒ 该格 UNVERIFIED`); continue }
      const mn = Math.min(...vals), mx = Math.max(...vals)
      const ratio = mn > 0 ? mx / mn : null
      metrics.push({ metric: m, n: vals.length, median: round(median(vals), m === 'cumulative-layout-shift' ? 3 : 1), min: round(mn, 3), max: round(mx, 3), spread: ratio == null ? null : round(ratio, 2) })
      if (ratio != null && ratio >= 2) notes.push(`${g.key}/${m}：同机同站同批倍差 ${ratio.toFixed(2)}×（${round(mn, 1)} → ${round(mx, 1)}）⇒ **单样本不足以定基线**`)
      if (ratio == null && mx > 0 && mn === 0) notes.push(`${g.key}/${m}：下界为 0（如空闲页 TBT），倍差不定义，只报极值`)
    }
    const days = [...new Set(g.fetchTimes.map(dayOf))].sort()
    out.push({
      key: g.key, page: g.page, batch: g.batch, url: g.url, n: g.samples.length, excluded: g.excluded,
      fetchTimes: [...new Set(g.fetchTimes)].sort(), days, formFactors: [...g.formFactors].join('/'), metrics,
    })
  }

  const budget = budgetReadiness(out, roster, notes)
  // 取数节奏（R56-H3 的机器面）：这条腿最大的风险不是判错，是**没人喂**。
  // 名册声明 `cadence.maxBatchAgeDays` ⇒ 判据按"最新完整批次距今天数"对比上限，越界就具名报红；
  // 没声明 ⇒ 只报"时效不判"，绝不把"没声明"读成"不会过期"（户内「能力位须有行为回执」同族）。
  let staleness = null
  if (roster.cadence && Number.isFinite(Number(roster.cadence.maxBatchAgeDays))) {
    const cap = Number(roster.cadence.maxBatchAgeDays)
    const newest = out.filter((g) => g.n >= 1 && g.metrics.length).map((g) => g.days[g.days.length - 1]).filter(Boolean).sort().pop() || ''
    const today = dayOf(now || '')
    const age = newest && today ? dayGap(newest, today) : null
    staleness = { cap, newest, today, age }
    if (!newest) problems.push(`时效：名册声明 cadence.maxBatchAgeDays=${cap} 却一个完整批次都没有 ⇒ 这一维本轮没测，不得当作"没变化"`)
    else if (age === null) problems.push(`时效：最新批次 ${newest} 与今日 ${today || '(无 now)'} 算不出天数差 ⇒ 不判，具名报出`)
    else if (age > cap) problems.push(`时效：最新完整批次 ${newest} 距今 ${age} 天 > 上限 ${cap} 天 ⇒ 这条腿**没人喂**了（复算：npm run collect:live-perf）`)
  } else {
    notes.push('时效：名册未声明 cadence.maxBatchAgeDays ⇒ 本件不判样本新鲜度（"没声明"不等于"不会过期"）')
  }
  const rc = problems.length ? 1 : 0
  return { rc, groups: out, problems, notes, unreadable: stats.artifact, notMeasured: stats.notMeasured, kept: stats.kept, budget, staleness }
}

/**
 * 立线条件（R56 的核心新增）：把"什么时候才配写 budget"从散文变成判决。
 * 需要同时满足：
 *   ① 该页有 ≥2 个**完整批次**（每批样本数 ≥ 名册 minSamples 且有中位数）；
 *   ② 两个可比批次的 fetchTime **日期差 ≥ 1 天**（同日两批只说明同机同日方差，不足以推"日常就这样"）；
 *   ③ 两批 formFactor 一致（否则口径不可比）。
 * 满足 ⇒ 印出两侧中位数与差值，并把"下一步=人写进名册 thresholds"说清楚；
 * 不满足 ⇒ 具名印缺哪一条（带实测天数差与批次样本数），**禁止**退化成"样本不足"四个字。
 */
function budgetReadiness(groups, roster, notes) {
  const byPage = new Map()
  for (const g of groups) {
    const page = roster.pages.find((p) => p.tag === g.page) || { minSamples: 1 }
    if (g.n >= (page.minSamples || 1) && g.metrics.length) {
      if (!byPage.has(g.page)) byPage.set(g.page, [])
      byPage.get(g.page).push(g)
    }
  }
  const perPage = []
  for (const [page, gs] of [...byPage.entries()].sort()) {
    if (gs.length < 2) {
      perPage.push({
        page, ready: false, completeBatches: gs.length,
        why: `完整批次 ${gs.length} 个（<2）⇒ 没有"两侧分布"，立线条件不成立`,
      })
      continue
    }
    gs.sort((a, b) => String(a.days[0]).localeCompare(String(b.days[0])))
    const a = gs[0], b = gs[gs.length - 1]
    const gap = dayGap(a.days[0], b.days[0])
    if (a.formFactors !== b.formFactors) {
      perPage.push({ page, ready: false, gap, why: `两批 formFactor 不同（${a.formFactors} ⇄ ${b.formFactors}）⇒ 口径不可比` })
      continue
    }
    if (gap === null) {
      perPage.push({ page, ready: false, why: '批次缺 fetchTime ⇒ 无法判断是否跨日' })
      continue
    }
    if (gap < 1) {
      perPage.push({
        page, ready: false, gap, batches: [a.key, b.key],
        why: `最新两个完整批次同日（${a.days[0]} ⇄ ${b.days[0]}，差 ${gap} 天）⇒ 只测到同日方差，未测到跨日方差`,
        intraDay: diffMedians(a, b),
      })
      continue
    }
    perPage.push({
      page, ready: true, gap, batches: [a.key, b.key], days: [a.days[0], b.days[0]],
      diffs: diffMedians(a, b),
      why: `两侧分布已具备（${a.days[0]} vs ${b.days[0]}，差 ${gap} 天）⇒ 可以把 budget 写进名册 thresholds 了（本件仍不替你写）`,
    })
    notes.push(`${page}：跨日两批（差 ${gap} 天）中位数最大偏移 ${maxAbsPct(diffMedians(a, b))}% ⇒ 立线时要把这个偏移量算进余量，别拿单批中位数当"日常"`)
  }
  const anyReady = perPage.some((p) => p.ready)
  return { lineSet: !!(roster.thresholds && Object.keys(roster.thresholds).length), anyReady, perPage }
}

function diffMedians(a, b) {
  const rows = []
  for (const m of a.metrics) {
    const other = b.metrics.find((x) => x.metric === m.metric)
    if (!other || m.median == null || other.median == null) continue
    const d = round(other.median - m.median, 1)
    const pct = m.median > 0 ? round((d / m.median) * 100, 1) : null
    rows.push({ metric: m.metric, first: m.median, second: other.median, delta: d, pct })
  }
  return rows
}
const maxAbsPct = (rows) => (rows.length ? Math.max(...rows.map((r) => Math.abs(r.pct || 0))) : 0)

function fmtRow(g) {
  return g.metrics.map((m) => `    ${m.metric.padEnd(24)} 中位 ${String(m.median).padStart(8)}｜[${m.min} .. ${m.max}]｜倍差 ${m.spread == null ? 'n/a' : m.spread + '×'}｜样本 ${m.n}`).join('\n')
}

function fmtBudget(b) {
  const lines = []
  for (const p of b.perPage) {
    lines.push(`  立线 ${p.page}：${p.ready ? '条件成立' : '条件不成立'}｜${p.why}`)
    const rows = p.ready ? p.diffs : p.intraDay
    if (rows) {
      for (const r of rows) lines.push(`      ${r.metric.padEnd(24)} ${r.first} → ${r.second}（${r.delta >= 0 ? '+' : ''}${r.delta}${r.pct == null ? '' : `，${r.pct >= 0 ? '+' : ''}${r.pct}%`}）`)
    }
  }
  if (!b.perPage.length) lines.push('  立线：名册里的页没有一个拿到完整批次 ⇒ 这一维本轮没有任何"两侧分布"')
  return lines
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
    ['⑪ 批次切分：`admin-d2-s1.json` 必须归到 page=admin／batch=d2，而不是"野标签"',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk(), 'admin-d2-s2.json': mk() }, roster },
      (r) => r.rc === 0 && r.groups.length === 2 && r.groups.map((g) => g.key).join(',') === 'admin/base,admin/d2'
        && r.groups.every((g) => g.page === 'admin')],
    ['⑫ 变异体（同日两批不许当跨日）：两批 fetchTime 同一天 ⇒ 立线不成立，且必须印出实测天数差 0',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk({ fetchTime: '2026-09-29T09:55:34.216Z' }), 'admin-d2-s2.json': mk({ fetchTime: '2026-09-29T09:57:08.049Z' }) }, roster },
      (r) => r.budget.anyReady === false && r.budget.perPage.length === 1
        && /差 0 天/.test(r.budget.perPage[0].why) && r.budget.perPage[0].intraDay.length > 0],
    ['⑬ 对偶正向（把日期改成隔 1 天，同一条腿必须翻成"条件成立"）：证明⑫不是写死的否',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk({ fetchTime: '2026-09-30T09:55:34.216Z' }), 'admin-d2-s2.json': mk({ fetchTime: '2026-09-30T09:57:08.049Z' }) }, roster },
      (r) => r.budget.anyReady === true && r.budget.perPage[0].gap === 1 && r.budget.perPage[0].diffs.length > 0
        && r.notes.some((x) => x.includes('跨日两批（差 1 天）'))],
    ['⑭ 反例：批次内样本不足 ⇒ 该批不进"两侧分布"，立线点名完整批次数',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk({ fetchTime: '2026-09-30T09:55:34.216Z' }) }, roster },
      (r) => r.budget.anyReady === false && r.budget.perPage[0].completeBatches === 1 && /完整批次 1 个/.test(r.budget.perPage[0].why)],
    ['⑮ 三态分列：网络类 NO_FCP + about:blank 归"未采到"，与"产物不符"不共用一个数',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank' }) }, roster },
      (r) => r.notMeasured === 1 && r.unreadable === 0 && r.problems.some((p) => p.includes('**这一批没采到**'))],
    ['⑯ 反例：整批全部未采到 ⇒ 该批样本数按 0 计，不许用"名册在册"冒充"这一批测到了"',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk(), 'admin-d2-s1.json': mk({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank' }), 'admin-d2-s2.json': mk({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank' }) }, roster },
      (r) => r.rc === 1 && r.groups.find((g) => g.key === 'admin/d2').n === 0
        && r.problems.some((p) => p.includes('admin/d2：样本 0 < 名册要求 2'))],
    ['⑰ 名册已写 thresholds 时 ⇒ 判据如实转述"线在哪"，但不自行改线',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk() }, roster: { ...roster, thresholds: { 'first-contentful-paint': { max: 3000 } } } },
      (r) => r.budget.lineSet === true && r.groups.length === 1],
    ['⑱ 反例（取数节奏）：名册声明 cadence=3 天、最新完整批次距今 10 天 ⇒ 必须具名报"没人喂"',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk() }, roster: { pages: roster.pages, cadence: { maxBatchAgeDays: 3 } }, now: '2026-10-09T00:00:00Z' },
      (r) => r.rc === 1 && r.staleness.age === 10 && r.problems.some((p) => p.includes('**没人喂**'))],
    ['⑲ 对偶（证明⑱不是写死的否）：同数据把"今日"挪到批次当天 ⇒ 时效腿不得报红',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk() }, roster: { pages: roster.pages, cadence: { maxBatchAgeDays: 3 } }, now: '2026-09-29T00:00:00Z' },
      (r) => r.rc === 0 && r.staleness.age === 0 && !r.problems.some((p) => p.includes('时效'))],
    ['⑳ 反例：名册声明了 cadence 却一个完整批次都没有 ⇒ 报"没测"而不是"没变化"',
      { samples: { 'admin-s1.json': mk({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank' }) }, roster: { pages: roster.pages, cadence: { maxBatchAgeDays: 3 } }, now: '2026-09-29T00:00:00Z' },
      (r) => r.problems.some((p) => p.includes('却一个完整批次都没有'))],
    ['㉑ 反向腿：名册没声明 cadence ⇒ 明说"不判新鲜度"，不许把没声明当成不会过期',
      { samples: { 'admin-s1.json': mk(), 'admin-s2.json': mk() }, roster, now: '2027-01-01T00:00:00Z' },
      (r) => r.rc === 0 && r.staleness === null && r.notes.some((x) => x.includes('未声明 cadence'))],
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
    console.log(`[report:live-perf] UNVERIFIED 样本目录不存在：${dir} ⇒ 本轮**没测**，不得与"测了且快"共用沉默态。取证命令：npm run collect:live-perf`)
    return 2
  }
  const all = readdirSync(dir).filter((f) => f.endsWith('.json'))
  // 只认 `<page>[-<batch>]-s<n>.json` 这一种命名（名册/日志/顺手放进来的别的 json 都不算样本）。
  // 一手教训来自本件夹具的第一次真跑：名册 `roster.json` 与被测样本同目录，于是它被当成
  // "标签不在名册里"判红 —— 判据把**自己的输入**当成了被审对象。跳过可以，但必须点名，
  // 不然下一轮加个 `summary.json` 就静默少算一份样本（户内「0 命中要先证输入非空」同族）。
  const files = all.filter((f) => /-s\d+\.json$/.test(f))
  const skipped = all.filter((f) => !/-s\d+\.json$/.test(f))
  if (files.length === 0) {
    console.log(`[report:live-perf] UNVERIFIED ${dir} 里没有符合 \`<page>[-<batch>]-s<n>.json\` 的样本（该目录 .json 共 ${all.length} 个：${skipped.join(', ') || '无'}）⇒ 本轮**没测**，不得与"测了且快"共用沉默态。取证命令：npm run collect:live-perf`)
    return 2
  }
  const samples = {}
  for (const f of files) {
    try { samples[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch (e) { samples[f] = { __parseError: e.message.split('\n')[0] } }
  }
  const r = evaluate({ samples, roster, now: new Date().toISOString() })
  if (r.rc === 2) { console.log(`[report:live-perf] UNVERIFIED ${r.why}`); return 2 }
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ rc: r.rc, groups: r.groups, budget: r.budget, staleness: r.staleness, problems: r.problems, notes: r.notes, unreadable: r.unreadable, notMeasured: r.notMeasured, kept: r.kept, skipped }, null, 2))
    return r.rc
  }
  for (const g of r.groups) {
    console.log(`GROUP ${g.key}｜${g.url}｜样本 ${g.n} 份（剔 ${g.excluded}）｜formFactor=${g.formFactors}｜日 ${g.days.join('/') || '?'}｜fetchTime ${g.fetchTimes.join(' ~ ')}`)
    console.log(fmtRow(g))
  }
  console.log('BUDGET（立线条件由本件现算，不由人记得）')
  for (const l of fmtBudget(r.budget)) console.log(l)
  if (r.staleness) console.log(`  时效：上限 ${r.staleness.cap} 天｜最新完整批次 ${r.staleness.newest || '(一个都没有)'}｜今日 ${r.staleness.today}｜距今 ${r.staleness.age ?? '(算不出)'}`)
  for (const n of r.notes) console.log(`NOTE  ${n}`)
  if (skipped.length) console.log(`NOTE  ${dir} 里 ${skipped.length} 个 .json 不是样本命名（\`<page>[-<batch>]-s<n>.json\`），已跳过并点名：${skipped.join(', ')}`)
  for (const p of r.problems) console.log(`· ${p}`)
  const s = r.kept
  const closed = s + r.notMeasured + r.unreadable === files.length
  if (!closed) problems.push(`门面恒等式不闭合：入统计 ${s} + 未采到 ${r.notMeasured} + 产物不符 ${r.unreadable} ≠ 样本文件 ${files.length} ⇒ 判据自己漏算了样本，这条红是**本件的缺陷**不是现网的`)
  const complete = r.groups.filter((g) => !g.excluded).length
  const ready = r.budget.perPage.filter((p) => p.ready).map((p) => p.page)
  const line = r.budget.lineSet ? '名册已写线（本件不自行改线）' : `未立（${ready.length ? `立线条件已成立：${ready.join('/')}` : '立线条件不成立，见 BUDGET 段'}）`
  console.log(`[report:live-perf] verdict=${(r.rc || !closed) ? 'RED' : 'GREEN'} rc=${r.rc || (closed ? 0 : 1)}｜名册 ${roster.pages.length} 页｜批次组 ${complete}/${r.groups.length} 完整｜入统计 ${s}／未采到 ${r.notMeasured}／产物不符 ${r.unreadable}／文件 ${files.length}（恒等式 ${closed ? '✓' : '✗'}）｜达标线=${line}`)
  return r.rc || (closed ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
