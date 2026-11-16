#!/usr/bin/env node
/**
 * check-governance-framework.mjs —— 契约治理 ⇄ 体量治理 登记册的三向对账（第七十六轮）
 *
 * 为什么立它（不是又一条覆盖率报告）：本轮把两套治理写成册之后，册子里每个数字都可能与盘中现值脱钩，
 * 而人读规范（docs/governance/*.md）又可能引用册里根本不存在的 id。已有一物一判的既有闸只管各自那一面：
 *   · verify:contract / verify:openapi / verify:response 管「实现 ⇄ 生成物」；
 *   · check:contract-diff 管「生成物 ⇄ 上一版」；
 *   · verify:limits 管「上限登记 ⇄ 代码取值」；
 *   · verify:volume 管「记忆卷字节 ⇄ 阈值」。
 * 没有任何一条管「治理登记册 ⇄ 盘中现值」与「人读文档 [registry:id] ⇄ 册内 id」这两条缝 —— 本件只补这两条。
 *
 * 三态退出码（与本仓其余判据同口径）：
 *   0 = 全绿；1 = 判出违规（键值不符 / 引用幽灵 / 路径不存在 / 文档抄写现值）；2 = 环境不满足或读数不可得（UNVERIFIED）。
 * 零输入不得记 PASS：源件不在盘、册读不出、文档 0 字节一律 rc=2。
 * **退出码优先级（第七十六轮）**：有已知违规时一律 rc=1，即使同时存在未验腿 ——
 *   「这一腿没量到」不得把「那一腿已经量出违规」盖掉（两者都印出来，但不让未验优先）。
 *
 * 第七十六轮新增三腿（每一腿都由实测红过才立）：
 *   F10 联动三段式（契约变更 → 承载增量 → 余量变化）+ 协同告警：单侧只报警，双侧同时命中才 rc=1；
 *       仓基线取不到 / 读数超龄 ⇒ UNVERIFIED，**不折算成"本笔无写放大"**。
 *   F11 文档现值抄写：登记册 README §一已声明"规范只解释口径、不复写数字"，但五份规范里仍手抄着
 *       入口壳字节、verify 段数、闸脚本数等现值 —— 会静默过期（实测：抄的 42/68/3132 对现算 43/69/2657）。
 *       本腿把"同标签数字必须是现值"变成机器可判；处置是改引用形态（[registry:id] / facts 段），不是改数字求绿。
 *   F12 消费面接地：每条四态消费命令必须在源码里自声明 `// @consumer-states:` 与 `// @consumer-no-line:`
 *       （借本仓 @probe-safe 的"被试对象自声明、判据只机械核对"口径），册内声明与源码自声明双向相等；
 *       缺消费面即红 —— 「阈值没人消费」与「NO-LINE 被读成通过」是同一族失效。
 *
 * 用法：node scripts/check-governance-framework.mjs [--json] [--selftest] [--fixture <dir>]
 */
// @consumer-states: FAIL,PASS,UNVERIFIED
// @consumer-no-line: UNVERIFIED 只表示"这一次没量到"⇒ 不得读成通过；rc=2 与 rc=0 分开且 FAIL 优先于 UNVERIFIED
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { requireInputs, requireJson } from './lib/preflight.mjs'
import { CONTENT_MAX_DEFAULT, SHELL_MAX_DEFAULT } from './check-memory-volume.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY = 'docs/governance/registry.json'
export const DOC_DIR = 'docs/governance'
export const DOC_FILES = ['README.md', '契约全生命周期规范.md', '体量治理规范.md', '数据互通与联动分析.md', '分步推进计划.md']
export const MIN_DOC_BYTES = 1200
export const CORE_ID_PREFIXES = ['lc-', 'bl-', 'rl-', 'op-', 'ld-']

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const bt = String.fromCharCode(96)
const CODE_SPAN_PATH_RE = new RegExp(bt + '((?:docs|scripts|db|functions|src)/[^' + bt + ']+)' + bt, 'g')
// 引用形态必须是「册内 id 的前缀族」：只写 [A-Za-z0-9._-]+ 会把文档里说明语法用的模板串
// （[registry:...] / [registry:<id>]）当成幽灵引用 —— 实测（2026-10-18）当场抓到一条 `...`，
// 而它根本不是引用。白名单由登记册的 id 前缀构成，不是由被审文档自证。
const DOC_REF_RE = /\[registry:((?:lc|bl|rl|op|ld)-[A-Za-z0-9._-]+)\]/g

/** 递归枚举文件（相对仓库根的 POSIX 路径）。 */
export function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) listFiles(p, base, out)
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}

export function sizeOf(p) { try { return statSync(p).size } catch { return -1 } }

/** 契约 action 数：/web 与 /pub 各自的 action 键数（真相源当场算，脚本内不抄第二份）。 */
export function contractActions(root = ROOT) {
  const doc = readJson(join(root, 'docs/api-contract.json'))
  const n = (ep) => { const a = doc.endpoints && doc.endpoints[ep] && doc.endpoints[ep].actions; return a ? Object.keys(a).length : 0 }
  return { web: n('/web'), pub: n('/pub') }
}

/** verify 聚合链的段数（只数 scripts.verify，不数子链 —— 子链段落数会随实现漂移）。 */
export function verifyLegs(root = ROOT) {
  const pkg = readJson(join(root, 'package.json'))
  const v = String((pkg.scripts || {}).verify || '')
  return v ? v.split('&&').length : 0
}

export function gateScripts(root = ROOT) {
  return readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).length
}

/**
 * CI job 名单：jobs: 段里两空格缩进的键。计数**必须**逐行匹配到扫描结束符而不是用 \n 后缀 ——
 * 本机实测（2026-10-18）：用 '\njobs:\n' + 正则 /^  k:$/m 会把 on.jobs 段之后的行切掉（job 键全部带缩进、
 * 但切片起点算错），当场把 6 个 job 读成 1 个。这正是本件要防的「计数由错解析得出」。
 */
export function ciJobNames(root = ROOT) {
  const text = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (start < 0) return null
  const names = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i]
    if (/^\S/.test(l)) break
    const m = /^  ([a-zA-Z0-9_-]+):[ \t]*(?:#.*)?$/.exec(l)
    if (m) names.push(m[1])
  }
  return names
}

/** facts 只收**标量现值**（对账靠逐叶子键相等，数组/子键结构一变就整组失配 ⇒ 把名单拆成独立导出）。 */
export function ciJobs(root = ROOT) {
  const names = ciJobNames(root)
  const contract = existsSync(join(root, '.ci/contract.json')) ? readJson(join(root, '.ci/contract.json')).requiredJobs || [] : []
  return { value: names ? names.length : null, required: contract.length }
}

/** 上限登记册的数据行数（判据以当场输出为准，本册只记口径）。 */
export function limitRosterRows(root = ROOT) {
  const t = readFileSync(join(root, 'docs/limit-provenance.md'), 'utf8')
  return t.split(/\r?\n/).filter((l) => /^\| /.test(l) && !/^\|\s*文件/.test(l) && !/^\|\s*-{2,}/.test(l)).length
}

export function itemBudgets(root = ROOT) {
  const j = readJson(join(root, 'docs/item-budgets.json'))
  return { registered: (j.items || []).length, noBudgetMax: Number(j.noBudgetMax) }
}

/**
 * 记忆卷两档上限 + 运行时读数（第七十六轮 I-76-1）。
 *
 * 改这一面之前它长什么样（实测红）：content 用 `/= 4096|4096\\b/` 的**宽匹配**取，
 * 于是判据源码里任何一处 4096 都能让它成立 —— 常量改名/换值它照样回 4096，等于没有对账。
 * 现改成：阈值由 `check-memory-volume.mjs` **导出**（同一把尺只此一份），读数当场 stat。
 *
 * 更要紧的是**运行时读数不能再手抄**：上一版册里写 `mainShellBytes 3132`，而实测入口壳已 4188B
 * （且当时主卷并不在盘上，判据印出来的是 2657B）⇒ 手抄的"现值"会在无人察觉时变成历史。
 * 所以运行时那一半也进 facts，谁都不写数字。
 *
 * 体量预算只登记**静态量**：单卷/外壳阈值 + 来源 + 开关。运行时读数（主卷字节、最大内容卷、
 * 外层壳三项）不进 facts —— 册里存它们就是第二真相源，且 F2 只遍历现算侧会把它们判成「缺键」。
 * 运行时量由 check-memory-volume.mjs 自己判（V1..V7），本件不重复立尺。
 */
export function memoryLimits(_root = ROOT) {
  // facts 里只放**可登记的静态量**（阈值/来源/开关）——运行时读数一律不进 facts：
  // ① 册里存运行时值 = 第二真相源，本机一改工作区册子当场过期（第七十六轮一手实测：
  //    册写 mainShellBytes 2657 而 HEAD 版 3132，CI 检出用 HEAD ⇒ 每次 CI 都判「不符」）；
  // ② F2 的 walk 只遍历现算侧 ⇒ 现算多出来的键一律落「册内缺键」⇒ UNVERIFIED，
  //    而那不是「没人立过口径」，是「这一半不该由册登记」（两件事必须分开）。
  // 运行时量（mainShellBytes / maxContentVolumeBytes / outerShell*）由
  // scripts/check-memory-volume.mjs 自己判，本件不重复立尺。
  return {
    contentMaxBytes: CONTENT_MAX_DEFAULT,
    shellMaxBytes: SHELL_MAX_DEFAULT,
    contentMaxBytesSource: 'scripts/check-memory-volume.mjs:CONTENT_MAX_DEFAULT（导入，不抄）',
    checkPatternUtf8Safe: true,
  }
}

/** 业务体量：把 schema + seed 在内存 SQLite 里重放，数出来的才是可以复算的现值。 */
export async function seedCatalog(root = ROOT) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(join(root, 'db/schema.sql'), 'utf8'))
  db.exec(readFileSync(join(root, 'db/seed.sql'), 'utf8'))
  const one = (sql) => Number(db.prepare(sql).all()[0].c)
  return { products: one('SELECT COUNT(*) c FROM products'), enabled: one('SELECT COUNT(*) c FROM products WHERE enabled=1'), orders: one('SELECT COUNT(*) c FROM orders') }
}

export function d1Quota(root = ROOT) {
  const j = readJson(join(root, 'docs/d1-write-quota.json'))
  return { dailyRowsWrittenFree: j.daily_rows_written_free, peakRowsWritten: j.peakRowsWritten, callsPerDayAtPeak: j.callsPerDayAtPeak }
}

export function d1Usage(root = ROOT) {
  const j = readJson(join(root, 'docs/d1-remote-usage.json'))
  const g = (j.channels || {}).graphql || {}
  const byDate = g.byDateUtc || []
  const last = byDate.length ? byDate[byDate.length - 1] : []
  return { rowsWrittenLastDay: last[1] ? last[1].rowsWritten : null, rowsReadLastDay: last[1] ? last[1].rowsRead : null, dayUtc: last[0] || null }
}

/** 首屏预算：从既有判据的 BUDGET 常量读（不抄）。 */
export function bundleBudget(root = ROOT) {
  const t = readFileSync(join(root, 'scripts/check-bundle-size.mjs'), 'utf8')
  const num = (k) => { const m = new RegExp(k + '\\s*:\\s*(\\d+)\\s*\\*\\s*(\\d+)').exec(t); return m ? Number(m[1]) * Number(m[2]) : null }
  return { firstLoadJsBytes: num('firstLoadJs'), firstLoadCssBytes: num('firstLoadCss'), largestChunkBytes: num('largestChunk') }
}

export function perfLines(root = ROOT) {
  const j = readJson(join(root, 'docs/live-perf.json'))
  const th = j.thresholds || {}
  const g = (k) => (th[k] && typeof th[k].max === 'number') ? th[k].max : null
  return {
    fcp: g('first-contentful-paint'), lcp: g('largest-contentful-paint'), cls: g('cumulative-layout-shift'),
    tbt: g('total-blocking-time'), si: g('speed-index'), srt: g('server-response-time'),
    // 第七十六轮 I-76-2：消费面不在"线"里，而在**谁读这条线**。三条都是运行时读数，禁手抄（手抄必过期）。
    lineCount: Object.keys(th).length,
    cadenceMaxBatchAgeDays: (j.cadence && Number.isFinite(j.cadence.maxBatchAgeDays)) ? j.cadence.maxBatchAgeDays : null,
    rosterSha256: hashFile(join(root, 'docs/live-perf.json'), 'sha256'),
  }
}

/** 文件 sha256（读不到回 null；禁把"读不到"写成空串冒充"文件是空的"）。 */
export function hashFile(p, algo = 'sha256') {
  try { return createHash(algo).update(readFileSync(p)).digest('hex') } catch { return null }
}

/** 代码面件数：按扩展名结构枚举（不依赖 git 与工作树状态）。 */
export function codeCounts(root = ROOT) {
  const count = (dir, re) => listFiles(join(root, dir)).filter((f) => re.test(f)).length
  return { files: { functions: count('functions', /\.(js|cjs|mjs)$/), src: count('src', /\.(ts|tsx)$/) } }
}

/**
 * 现算事实集：形状必须与登记册 facts 的叶子键一一对应（多出来的键由 F2 判红，缺的键由 F2 报 UNVERIFIED）。
 * 本函数是「真相源当场算」的唯一入口 —— 任何人想改登记值，改的都是被比对的这一侧之外的那一侧。
 */
export async function computeFacts(root = ROOT) {
  return {
    contractActions: contractActions(root),
    verifyLegs: { value: verifyLegs(root) },
    gateScripts: { value: gateScripts(root) },
    ciJobs: ciJobs(root),
    limitRosterRows: { value: limitRosterRows(root) },
    itemBudgets: itemBudgets(root),
    memoryVolume: memoryLimits(root),
    seedCatalog: await seedCatalog(root),
    d1Quota: d1Quota(root),
    d1Usage: d1Usage(root),
    bundleBudget: bundleBudget(root),
    perfLines: perfLines(root),
    codeFace: codeCounts(root),
  }
}

/** 登记册里所有 id（对象带 id 字段者），用于「文档引用 ⇄ 册内 id」双向对账。 */
export function collectRegistryIds(node, out = []) {
  if (Array.isArray(node)) { for (const x of node) collectRegistryIds(x, out); return out }
  if (node && typeof node === 'object') {
    if (typeof node.id === 'string') out.push(node.id)
    for (const v of Object.values(node)) collectRegistryIds(v, out)
  }
  return out
}

/** 文档里的 [registry:<id>] 引用（去重）。 */
export function collectDocRefs(text) {
  return [...new Set([...String(text).matchAll(DOC_REF_RE)].map((m) => m[1]))]
}

// ── 第七十六轮 P2 三腿的取数件（全部当场算，禁抄第二份）────────────────────────

/** 记一笔失败的三态原因：读不到 / 不是合法 JSON / 结构不符。都返回 { state:'unavailable', why }。 */
const unavail = (why) => ({ state: 'unavailable', why })

/**
 * 契约侧的写放大（F10 链A）：把当前 docs/api-contract.json 与 docs/sql-baseline.json
 * 和 **main 上已验证的那一笔**逐键比。基线取不到 ⇒ 返回 unavailable（**不返回全 0**：
 * 全 0 会让"本笔无写放大"凭空成立，那是「盲区不是零」）。
 */
export function contractDeltaOf(root = ROOT, baseRev = 'HEAD') {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', baseRev], { cwd: root, encoding: 'utf8' })
  const sha = (r.stdout || '').trim()
  if (r.status !== 0 || !sha) return unavail('git 取不到基线 ' + baseRev + '（rc=' + r.status + '）⇒ 没有可比对象')
  const show = (p) => spawnSync('git', ['show', sha + ':' + p], { cwd: root, encoding: 'utf8' })
  const showB = show('docs/sql-baseline.json')
  if (showB.status !== 0) return unavail('基线上没有 docs/sql-baseline.json（' + sha + '）')
  let cur
  let base
  try {
    cur = readJson(join(root, 'docs/sql-baseline.json'))
    base = JSON.parse(showB.stdout)
  } catch (e) { return unavail('sql-baseline 解析失败：' + e.message.split('\n')[0]) }
  const curPeak = (cur && cur.peakStatements) || {}
  const basePeak = (base && base.peakStatements) || {}
  const newActions = Object.keys(curPeak).filter((k) => !(k in basePeak))
  const raised = Object.keys(curPeak).filter((k) => (k in basePeak) && Number(curPeak[k]) > Number(basePeak[k]))
    .map((k) => ({ key: k, from: basePeak[k], to: curPeak[k] }))
  return { state: 'ok', baseRev, baseSha: sha, newActions, raised, curPeak, basePeak }
}

/**
 * 体量侧的余量（F10 链B/C）：配额件 + 峰值口径，当场算百分比。
 * 任何一个读不到 ⇒ remainingPct 为 null（**不写 0**：0% 会被读成"余量耗尽"）。
 */
export function quotaReading(root = ROOT) {
  try {
    const q = readJson(join(root, 'docs/d1-write-quota.json'))
    const dailyRows = Number(q.daily_rows_written_free)
    const peakRows = Number(q.peakRowsWritten)
    const callsPerDayAtPeak = Number(q.callsPerDayAtPeak)
    if (![dailyRows, peakRows, callsPerDayAtPeak].every((n) => Number.isFinite(n) && n > 0)) {
      return { dailyRows: null, callsPerDayAtPeak: null, peakRowsWritten: null, remainingPct: null, red: null, source: 'docs/d1-write-quota.json（字段不全）' }
    }
    const remainingPct = (1 - (callsPerDayAtPeak * peakRows) / dailyRows) * 100
    return { dailyRows, callsPerDayAtPeak, peakRowsWritten: peakRows, remainingPct, red: remainingPct < 5, source: 'docs/d1-write-quota.json' }
  } catch { return { dailyRows: null, callsPerDayAtPeak: null, peakRowsWritten: null, remainingPct: null, red: null, source: 'docs/d1-write-quota.json（读不到）' } }
}

/**
 * F11 的取数面：在五份规范里找「同标签 + 数字」的现抄形态，每个标签的**现值**由调用方给的 facts 现算。
 * 标签表刻意很短：只收**有明确现值来源**的那些。收得宽会把"预算 95KB"这类**阈值**误判成漂移
 * （阈值本来就该是常数，不是现值）—— 判据的第一假阳性来源就是"把两种数字当一种"。
 */
export const COPIED_LABELS = [
  // 每条都是「标签 + 现值数字」的**明确写法**。刻意不收裸数字：同一行里还有阈值（≤42 / 43–48 / ≥49），
  // 把阈值当现值判会制造第一类假阳性 —— 而判据的假阳性比漏报更贵（它教人下一轮把闸关掉）。
  { label: 'verify 段数', re: /verify[^\n]{0,12}?(\d+)\s*段/g, fact: (f) => f.verifyLegs && f.verifyLegs.value },
  { label: 'verify 段数', re: /段数\s*[=＝]\s*\**\s*(\d+)/g, fact: (f) => f.verifyLegs && f.verifyLegs.value },
  { label: '闸脚本数', re: /闸脚本数[^\n\d]{0,40}?(\d+)\s*(?:件|个)/g, fact: (f) => f.gateScripts && f.gateScripts.value },
  { label: '闸脚本数', re: /scripts\/\s*下\s*\.mjs\s*=\s*\**\s*(\d+)/g, fact: (f) => f.gateScripts && f.gateScripts.value },
  { label: '入口卷字节', re: /入口[卷壳][^\n\d]{0,10}?(\d+)\s*B/g, fact: (f) => f.memoryVolume && f.memoryVolume.mainShellBytes },
]

/** 抽出文档里的现抄数字（带出处与行号）。 */
export function copiedValuesOf(docs, facts) {
  const out = []
  for (const d of docs || []) {
    const lines = String(d.text || '').split(/\r?\n/)
    for (const spec of COPIED_LABELS) {
      const actual = spec.fact(facts)
      if (!Number.isFinite(actual)) continue
      for (let i = 0; i < lines.length; i += 1) {
        spec.re.lastIndex = 0
        let m
        while ((m = spec.re.exec(lines[i])) !== null) {
          out.push({ doc: d.path, line: i + 1, label: spec.label, value: Number(m[1]), actual })
        }
      }
    }
  }
  return out
}

/**
 * 纯判据。ctx = { registry, facts, docs: [{path, text, bytes}], sources: [{path, bytes}], docRefs, registryIds, quotedPaths: [{path, from}] }
 * 九个面各自独立成行，任一行 FAIL 即 rc=1；UNVERIFIED 行存在则 rc=2（且绝不折算成绿）。
 */
export function evaluate(ctx) {
  const rows = []
  const unverified = []
  const { registry, facts, docs } = ctx
  const push = (id, pass, detail, unver = false) => { rows.push({ id, pass: unver ? null : !!pass, detail }); if (unver) unverified.push(id) }

  // F1 源件在盘非空（零输入不得记 PASS）
  const empty = docs.filter((d) => d.bytes <= 0)
  push('F1', registry && docs.length === DOC_FILES.length && empty.length === 0,
    '源件：登记册 1 份 + 人读文档 ' + docs.length + '/' + DOC_FILES.length + ' 份；0 字节 ' + empty.length + ' 份' + (empty.length ? '（' + empty.map((d) => d.path).join(', ') + '）' : ''))

  // F2 登记值 ⇄ 现算值（逐叶子键）
  const diffs = []
  const missing = []
  const walk = (reg, cur, path) => {
    if (cur === null || cur === undefined) { missing.push(path); return }
    if (typeof cur === 'object' && !Array.isArray(cur)) {
      for (const [k, v] of Object.entries(cur)) walk((reg || {})[k], v, path ? path + '.' + k : k)
      return
    }
    if (reg === undefined) { missing.push(path); return }
    if (String(reg) !== String(cur)) diffs.push(path + '：册 ' + reg + ' ⇄ 实测 ' + cur)
  }
  for (const [k, v] of Object.entries(facts)) walk((registry.facts || {})[k], v, k)
  const F2detail = 'facts 对账：比对 ' + Object.keys(facts).length + ' 组 / 不符 ' + diffs.length + ' / 册内缺键 ' + missing.length
    + (diffs.length ? ' ｜ ' + diffs.join('；') + ' ｜ 处置：改**册**（facts 是登记值，不是现值）' : '')
    + (missing.length ? ' ｜ 缺 ' + missing.join(',') + ' ｜ 处置：把现算多出来的这半边登记进册（缺键≠通过，也≠失败）' : '')
  // 缺键 ≠ 通过：册里没有这一项，说明「没人立过口径」或「现算多了个面」——两者都必须先有人补册，
  // 所以走 UNVERIFIED（rc=2），禁折算成 FAIL 后的「修到绿」，也禁折算成 PASS。
  if (missing.length) push('F2', false, F2detail, true)
  else push('F2', diffs.length === 0, F2detail)

  // F3 引用双向：幽灵引用 + 核心 id 未被引用
  const idSet = new Set(ctx.registryIds)
  const refSet = new Set(ctx.docRefs)
  const phantom = ctx.docRefs.filter((r) => !idSet.has(r))
  const core = [...idSet].filter((i) => CORE_ID_PREFIXES.some((p) => i.startsWith(p)))
  const orphan = core.filter((i) => !refSet.has(i))
  push('F3', phantom.length === 0 && orphan.length === 0,
    '引用对账：文档引用 ' + refSet.size + ' 个 id / 册内 id ' + idSet.size + ' 个（核心 ' + core.length + '）；幽灵引用 ' + phantom.length + (phantom.length ? '（' + phantom.join(', ') + '）' : '') + '；未被任何文档引用的核心 id ' + orphan.length + (orphan.length ? '（' + orphan.join(', ') + '）' : ''))

  // F4 联动键与规则完整性
  const lk = (registry.linkage || {})
  const jk = lk.joinKey || {}
  const rules = lk.rules || []
  const rulesOk = rules.length >= 4 && rules.every((r) => typeof r.acceptance === 'string' && r.acceptance.length > 4)
  const jkOk = typeof jk.definition === 'string' && /<endpoint>::<action>/.test(jk.definition)
  push('F4', jkOk && rulesOk, '联动：联结键 ' + (jk.id || '(缺)') + ' 键形 ' + (jkOk ? '合法' : '非法') + '；规则 ' + rules.length + ' 条，全部带 acceptance = ' + rulesOk)

  // F5 指标登记完整（来源可审计 + 三档阈值）
  const inds = ((registry.volume || {}).indicators) || []
  const bad = inds.filter((i) => !(i.source && ['machine', 'manual'].includes(i.source.op) && typeof i.source.measuredBy === 'string' && i.source.measuredBy.length > 4))
  const noTh = inds.filter((i) => !(i.thresholds && 'green' in i.thresholds && 'warn' in i.thresholds && 'red' in i.thresholds))
  push('F5', inds.length > 0 && bad.length === 0 && noTh.length === 0,
    '指标：' + inds.length + ' 条；来源不可审计 ' + bad.length + (bad.length ? '（' + bad.map((i) => i.id).join(', ') + '）' : '') + '；三档不全 ' + noTh.length + (noTh.length ? '（' + noTh.map((i) => i.id).join(', ') + '）' : ''))

  // F6 棘轮方向：下行为好的指标，绿档上界不得高于现算值（禁把地板抬到当前值之上）
  const ratchet = inds.filter((i) => i.direction === 'down-good')
  // 受绑表只收「现算值确实取到了」的指标：取不到 ⇒ 不参与 F6（由 F2 的缺键腿去点名），
  // 禁把取不到编成 0 —— 那是拿「没读到」冒充「没超线」。
  const binding = {}
  const bind = (k, v) => { if (typeof v === 'number' && Number.isFinite(v)) binding[k] = v }
  bind('op-verify-legs', facts.verifyLegs && facts.verifyLegs.value)
  bind('op-gate-scripts', facts.gateScripts && facts.gateScripts.value)
  bind('op-ci-jobs', facts.ciJobs && facts.ciJobs.value)
  bind('op-limit-rows', facts.limitRosterRows && facts.limitRosterRows.value)
  bind('op-no-budget', facts.itemBudgets && facts.itemBudgets.noBudgetMax)
  const loosened = []
  for (const i of ratchet) {
    if (!(i.id in binding)) continue
    const m = /(\d+)/.exec(String(i.thresholds.green))
    if (!m) { loosened.push(i.id + '（绿档无数字）'); continue }
    if (Number(m[1]) > Number(binding[i.id])) loosened.push(i.id + '：绿档 ' + m[1] + ' > 实测 ' + binding[i.id])
  }
  push('F6', loosened.length === 0, '棘轮：下行指标 ' + ratchet.length + ' 条（受绑 ' + Object.keys(binding).length + '）；放宽 ' + loosened.length + (loosened.length ? '（' + loosened.join('；') + '）' : ''))

  // F7 登记册点名的源路径必须存在且非空
  const badPaths = ctx.sources.filter((s) => s.bytes <= 0)
  push('F7', badPaths.length === 0 && ctx.sources.length > 0,
    '册内源路径：' + ctx.sources.length + ' 条；不存在或 0 字节 ' + badPaths.length + (badPaths.length ? '（' + badPaths.map((s) => s.path).join(', ') + '）' : ''))

  // F8 文档 code-span 里点名的仓内路径必须存在且非空（R240）
  const badQuoted = ctx.quotedPaths.filter((q) => q.bytes <= 0)
  push('F8', badQuoted.length === 0, '文档宣称路径：' + ctx.quotedPaths.length + ' 条；取不到 ' + badQuoted.length + (badQuoted.length ? '（' + badQuoted.map((q) => q.path + '@' + q.from).join(', ') + '）' : ''))

  // F9 人工读数语义：manual 指标必须写明未采时的处置（不得冒充机器现值）
  const manual = inds.filter((i) => i.source.op === 'manual')
  const noEvidence = manual.filter((i) => typeof i.source.evidence !== 'string' || i.source.evidence.length < 10)
  push('F9', noEvidence.length === 0, '人工读数：' + manual.length + ' 条；evidence 缺失 ' + noEvidence.length + (noEvidence.length ? '（' + noEvidence.map((i) => i.id).join(', ') + '）' : ''))

  // ── F10 联动三段式 + 协同告警（P2 / ac-2 第一条）────────────────────────────
  // 判什么：契约侧的写放大（本笔新 action 的语句数增量）与体量侧的配额余量**同窗并置**，
  //        产出「契约变更 → 承载增量 → 余量变化」三段；并判协同告警：余量 red 且本笔新增写 action / 语句数上升。
  // 不判什么：写放大的历史基线该取哪一笔（取的是 main 上"已验证"的基线，基线取不到就 UNVERIFIED）。
  // 为什么必须这么写：baseline 取不到时若直接算 0，会得到"本笔没有写放大"——那正是户内「盲区不是零」。
  const lj = ctx.linkage || null
  if (!lj) {
    push('F10', false, '联动：取数面未提供（本件拿不到仓基线/读数）⇒ 未验，不得折算成"本笔无写放大"', true)
  } else {
    const parts = []
    let ok10 = true
    // 未验（不是违规）：基线/配额取不到时只说明"这一腿没量到"，不得写成"本笔无写放大"。
    // 与"双侧命中阻断"是两条互斥的判决通道 ⇒ 用 unverified 通道而不是 FAIL 通道。
    let unver10 = false
    // 链A：契约变更
    const d = lj.contractDelta
    if (d.state === 'unavailable') { unver10 = true; parts.push('契约变更：基线取不到（' + d.why + '）') } else {
      const chg = d.newActions.length || d.raised.length
      parts.push('契约变更：本笔新增/'+"'"+'上升 ' + chg + ' 项（新增 ' + (d.newActions.join(',') || '无') + '；语句数上升 ' + (d.raised.map((x) => x.key + ' ' + x.from + '→' + x.to).join(',') || '无') + '）')
      if (!chg) parts.push('⇒ 无写放大，链B/C 记"不适用（本笔未改写面）"')
    }
    // 链B/C：只在真有契约变更时才需要余量并置
    const changed = d.state !== 'unavailable' && (d.newActions.length || d.raised.length)
    if (changed) {
      const q = lj.quota
      if (!q || !Number.isFinite(q.remainingPct)) { unver10 = true; parts.push('承载增量/余量变化：配额读数取不到 ⇒ 未验') } else {
        const addedRows = lj.addedRows
        parts.push('承载增量：' + (Number.isFinite(addedRows) ? addedRows + ' 行/调用（口径见 limit-scaling.json）' : '换算不出 ⇒ 未验'))
        parts.push('余量变化：' + q.remainingPct.toFixed(3) + '% → ' + (Number.isFinite(addedRows) ? (q.remainingPct - (addedRows / q.dailyRows || 0) * 100).toFixed(3) : '—') + '%（峰值 ' + q.callsPerDayAtPeak + ' 次/日 × 行数 / 日配额 ' + q.dailyRows + '）')
      }
    }
    // 协同告警：两侧同时命中才阻断
    const red = lj.quota && lj.quota.red === true
    const sideB = changed
    parts.push('协同告警：体量侧 ' + (red ? '余量 red' : '余量非 red') + '｜契约侧 ' + (sideB ? '本笔有写面变更' : '本笔无写面变更')
      + ' ⇒ ' + (red && sideB ? '**双侧同时命中，阻断（rc=1）**' : '单侧/无命中 ⇒ 只报警不阻断'))
    if (red && sideB) ok10 = false
    push('F10', ok10, parts.join('；'), unver10)
  }

  // ── F11 文档现值抄写（P2 / ac-2 第二条）────────────────────────────────────
  // 一手起因：登记册 README §一 明写"规范只解释口径、**不复写数字**"，而五份规范里手抄着
  // 入口壳字节 / verify 段数 / 闸脚本数等现值 —— 实测抄的是 42/68/3132，现算是 43/69/2657。
  // 处置必须是**改引用形态**（改用 [registry:id] 或直接删数），不是把数字改一遍求绿：
  // 改一遍能绿一轮，下一轮又过期，这正是"手抄现值"的病本身。
  const copied = ctx.copiedValues || []
  const driftedCopies = copied.filter((c) => c.actual !== c.value)
  const F11detail = '文档现值：检出 ' + copied.length + ' 处同标签数字；与现值不符 ' + driftedCopies.length
    + (driftedCopies.length ? ' ｜ ' + driftedCopies.map((c) => c.doc + ':' + c.line + ' "' + c.label + '" 抄 ' + c.value + ' ⇄ 现值 ' + c.actual).join('；') : '')
    + (copied.length ? '' : '（**零命中不等于没有抄写**：标签表变更时先改本判据，再改文档）')
  push('F11', driftedCopies.length === 0, F11detail)

  // ── F12 消费面接地（P2 / ac-2 第三条）──────────────────────────────────────
  // 借本仓 @probe-safe 的"被试对象自声明、判据只机械核对"口径：
  // 册内声明了哪条命令有消费面，就该在**那条命令的源码里**找到 @consumer-states / @consumer-no-line。
  // 为什么不是另写一份名单：手抄名单会过期；源码自声明不会。
  const consumers = (registry.volume || {}).consumers || []
  const consumerSrc = ctx.consumerSrc || {}
  const cProblems = []
  for (const c of consumers) {
    // 源码由调用方读好交进来（纯判据：evaluate 不碰磁盘 ⇒ 夹具能驱动每一条腿）
    const src = Object.prototype.hasOwnProperty.call(consumerSrc, c.id) ? consumerSrc[c.id] : null
    if (src === null) { cProblems.push(c.id + '：源码未交给判据（path=' + (c.path || '(未登记)') + '）'); continue }
    const m = /^\s*\/\/\s*@consumer-states:\s*(.+)$/m.exec(src)
    const n = /^\s*\/\/\s*@consumer-no-line:\s*(.+)$/m.exec(src)
    if (!m) { cProblems.push(c.id + '：源码缺 @consumer-states 自声明'); continue }
    if (!n) { cProblems.push(c.id + '：源码缺 @consumer-no-line 自声明'); continue }
    const srcStates = m[1].split(',').map((s) => s.trim()).filter(Boolean).sort()
    const regStates = [...(c.states || [])].sort()
    if (srcStates.join('|') !== regStates.join('|')) cProblems.push(c.id + '：状态集不符 册 ' + regStates.join('/') + ' ⇄ 源码 ' + srcStates.join('/'))
    const noLineIn = c.noLineStates || []
    if (noLineIn.length && !noLineIn.every((s) => srcStates.includes(s))) cProblems.push(c.id + '：noLineStates 有点不到的状态 ' + noLineIn.join('/'))
    if (!/不得|不算|不折|不是/.test(n[1])) cProblems.push(c.id + '：@consumer-no-line 必须写明"不得读成通过"的意思，现为「' + n[1].trim() + '」')
  }
  push('F12', consumers.length > 0 && cProblems.length === 0,
    '消费面：在册 ' + consumers.length + ' 条；不接地 ' + cProblems.length + (cProblems.length ? ' ｜ ' + cProblems.join('；') : '')
      + (consumers.length ? '' : '（**零消费者 ≠ 没有阈值**：阈值存在却无消费面，就是户内 M4 的失效形态）'))

  const failed = rows.filter((r) => r.pass === false)
  return { rows, unverified, failed, verdict: unverified.length ? 'UNVERIFIED' : (failed.length ? 'FAIL' : 'PASS') }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) return selftest()
  const json = args.includes('--json')
  const fixtureAt = args.indexOf('--fixture')
  const root = fixtureAt >= 0 ? args[fixtureAt + 1] : ROOT

  requireInputs('governance-framework', [
    join(root, 'package.json'),
    join(root, REGISTRY),
    join(root, DOC_DIR),
    join(root, 'scripts/check-memory-volume.mjs'),
    join(root, 'scripts/check-bundle-size.mjs'),
    join(root, 'docs/api-contract.json'),
    join(root, 'docs/item-budgets.json'),
    join(root, 'docs/limit-provenance.md'),
    join(root, 'docs/d1-write-quota.json'),
    join(root, 'docs/d1-remote-usage.json'),
    join(root, 'docs/live-perf.json'),
    join(root, '.github/workflows/ci.yml'),
  ])
  requireJson('governance-framework', [join(root, REGISTRY), join(root, 'docs/api-contract.json'), join(root, 'docs/item-budgets.json'), join(root, 'docs/d1-write-quota.json'), join(root, 'docs/live-perf.json'), join(root, 'package.json')])

  const registry = readJson(join(root, REGISTRY))
  const facts = await computeFacts(root)
  const docs = DOC_FILES.map((f) => { const p = join(root, DOC_DIR, f); return { path: DOC_DIR + '/' + f, text: existsSync(p) ? readFileSync(p, 'utf8') : '', bytes: sizeOf(p) } })
  const ids = collectRegistryIds(registry)
  const docRefs = [...new Set(docs.flatMap((d) => collectDocRefs(d.text)))]
  const sources = sourcePathsOf(registry).map((p) => ({ path: p, bytes: sizeOf(join(root, p)) }))
  const quotedPaths = []
  const seen = new Set()
  for (const d of docs) {
    for (const m of d.text.matchAll(CODE_SPAN_PATH_RE)) {
      // 只收「裸路径」形态：带空格（命令行参数）/ 通配 / 占位符/括号的一律不算路径主张，
      // 否则夹具词汇会把 `scripts/x.mjs --write`、`docs/**`、`docs/archive/` 这类读成缺失。
      const raw = m[1].trim().replace(/[）)。，,;；、]$/, '')
      if (/[\s*<>()[\]{}|$…]/.test(raw)) continue
      const last = raw.split('/').pop() || ''
      if (!/\./.test(last)) continue
      const key = raw + '@' + d.path
      if (seen.has(key)) continue
      seen.add(key)
      quotedPaths.push({ path: raw, from: d.path, bytes: sizeOf(join(root, raw)) })
    }
  }

  // F10 联动三段式 + F12 消费面源码（两件都由 main 取好交给纯判据）
  const delta = contractDeltaOf(root)
  // 基线挑选：工作树干净 ⇒ 这一笔已经提交，改判"最近一笔"（HEAD~1 → HEAD）的写面变化；
  // 否则判"未提交的改动"。两态都只能给出**可复算**的结论，绝不拿"没变化"顶替"没量到"。
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  const treeClean = dirty.status === 0 && !String(dirty.stdout || '').trim()
  const delta2 = (treeClean && delta.state === 'ok' && !delta.newActions.length && !delta.raised.length)
    ? contractDeltaOf(root, 'HEAD~1')
    : delta
  const quota = quotaReading(root)
  let addedRows = null
  try {
    const wq = readJson(join(root, 'docs/d1-write-quota.json'))
    const acts = (wq && wq.actions) || {}
    const keys = delta2.state === 'ok' ? delta2.newActions.concat(delta2.raised.map((r) => r.key)) : []
    if (keys.length) {
      const vals = keys.map((k) => Number(acts[k]))
      addedRows = vals.every((v) => Number.isFinite(v)) ? Math.max(...vals) : null
    } else addedRows = 0
  } catch { addedRows = null }
  const linkage = { contractDelta: delta2, quota, addedRows, treeClean }
  const consumers = (registry.volume || {}).consumers || []
  const consumerSrc = {}
  for (const c of consumers) {
    const p = join(root, c.path || '')
    consumerSrc[c.id] = existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  const copiedValues = copiedValuesOf(docs, facts)
  const result = evaluate({ registry, facts, docs, registryIds: ids, docRefs, sources, quotedPaths, linkage, consumerSrc, copiedValues })
  if (json) console.log(JSON.stringify({ schema: 'chaoshi-governance-framework-v1', root, verdict: result.verdict, rows: result.rows }, null, 2))
  else {
    console.log('[governance-framework] 登记册 ⇄ 盘中现值三向对账（' + REGISTRY + '）')
    for (const r of result.rows) console.log((r.pass === null ? 'UNVERIFIED' : r.pass ? 'PASS' : 'FAIL') + ' ' + r.id + ' ' + r.detail)
    console.log('[governance-framework] 结果: ' + result.rows.filter((r) => r.pass === true).length + ' 通过 / ' + result.failed.length + ' 失败 / ' + result.unverified.length + ' 未验 ｜ 判定=' + result.verdict)
  }
  // 退出码优先级：**已量出的违规**优先于"未验"（第七十六轮）。
  // 一手：本轮同时存在 F2 红灯与 F10 的 UNVERIFIED 时，旧口径会让 rc=2 ——
  // 「这一腿没量到」把「那一腿已经量出违规」盖掉了，读者只会看到"环境不满足"。
  process.exit(result.failed.length ? 1 : (result.unverified.length ? 2 : 0))
}

/** 从登记册里抽出所有被点名的仓内源路径（不含目录 'scripts/' 这类通配）。 */
export function sourcePathsOf(registry, out = []) {
  const seen = new Set()
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!n || typeof n !== 'object') return
    if (typeof n.path === 'string' && /\.(json|md|js|mjs|sql|yml)$/.test(n.path)) { if (!seen.has(n.path)) { seen.add(n.path); out.push(n.path) } }
    for (const v of Object.values(n)) walk(v)
  }
  walk(registry)
  return out
}

// ── selftest ─────────────────────────────────────────────────────────────────
const SYN_REG = {
  schema: 'chaoshi-governance-registry-v1',
  facts: { a: { v: 1 }, verifyLegs: { value: 42 }, gateScripts: { value: 1 }, ciJobs: { value: 1 }, limitRosterRows: { value: 1 }, itemBudgets: { noBudgetMax: 1 } },
  linkage: { joinKey: { id: 'ld-join-key', definition: '<endpoint>::<action>' }, rules: [{ id: 'ld-join-analyze', acceptance: 'acceptance-ok' }, { id: 'ld-join-cohort', acceptance: 'acceptance-ok' }, { id: 'ld-join-ingest', acceptance: 'acceptance-ok' }, { id: 'ld-join-window', acceptance: 'acceptance-ok' }] },
  volume: { consumers: [
    { id: 'op-x-consume', path: 'scripts/x.mjs', states: ['FAIL', 'PASS', 'UNVERIFIED'], noLineStates: ['UNVERIFIED'] },
  ], indicators: [
    { id: 'rl-x', direction: 'down-good', source: { op: 'machine', measuredBy: 'directory-enum' }, thresholds: { green: '<=3', warn: '4-5', red: '>=6' } },
    { id: 'op-verify-legs', direction: 'down-good', source: { op: 'machine', measuredBy: 'package-json-verify' }, thresholds: { green: '<=42', warn: '43-48', red: '>=49' } },
    { id: 'bl-manual', source: { op: 'manual', measuredBy: 'manual-online-count', evidence: '本机未采 ⇒ UNVERIFIED' }, thresholds: { green: 'g', warn: 'w', red: 'r' } },
  ] },
  lifecycle: { riskTiers: [{ id: 'lc-risk-t1' }, { id: 'lc-risk-t2' }, { id: 'lc-risk-t3' }], nodes: [{ id: 'lc-draft-author' }] },
  phases: [{ id: 'ph-1', acceptance: { id: 'ac-1', criteria: 'x' } }],
}
const SYN_DOCS = DOC_FILES.map((f) => ({ path: DOC_DIR + '/' + f, text: 'x'.repeat(MIN_DOC_BYTES), bytes: MIN_DOC_BYTES }))
// 合成"没改契约、余量充足"的联动面：F10 的正例必须由数据提供，不能靠"没给就绿"。
const SYN_LINKAGE = {
  contractDelta: { state: 'ok', baseRev: 'HEAD', baseSha: 'deadbee', newActions: [], raised: [] },
  quota: { dailyRows: 100000, callsPerDayAtPeak: 100, peakRowsWritten: 5, remainingPct: 99.5, red: false },
  addedRows: 0, treeClean: true,
}
const SYN_CONSUMER_SRC = '// @consumer-states: FAIL,PASS,UNVERIFIED\n// @consumer-no-line: UNVERIFIED 只表示没量到 ⇒ 不得读成通过\n'
function synCtx(over = {}) {
  const registry = over.registry || SYN_REG
  const ids = collectRegistryIds(registry)
  return Object.assign({
    registry,
    facts: over.facts || { a: { v: 1 }, verifyLegs: { value: 42 }, gateScripts: { value: 1 }, ciJobs: { value: 1 }, limitRosterRows: { value: 1 }, itemBudgets: { noBudgetMax: 1 } },
    docs: over.docs || SYN_DOCS,
    registryIds: ids,
    docRefs: over.docRefs || ids.filter((i) => CORE_ID_PREFIXES.some((p) => i.startsWith(p))),
    sources: over.sources || [{ path: 'package.json', bytes: 100 }],
    quotedPaths: over.quotedPaths || [{ path: 'package.json', from: 'README.md', bytes: 100 }],
    linkage: over.linkage === undefined ? SYN_LINKAGE : over.linkage,
    consumerSrc: over.consumerSrc || { 'op-x-consume': SYN_CONSUMER_SRC },
    copiedValues: over.copiedValues || [],
  }, {})
}
function selftest() {
  const legs = []
  const ok = (name, cond) => legs.push([name, !!cond])
  const R = (c) => evaluate(c)

  // 正例：全绿
  ok('正例：合成登记册与现算值一致 → PASS', R(synCtx()).verdict === 'PASS')
  // 违规 1：键值不符必须判红
  ok('违规：facts.v 1 ⇄ 实测 2 → FAIL', R(synCtx({ facts: { a: { v: 2 }, verifyLegs: { value: 42 }, gateScripts: { value: 1 }, ciJobs: { value: 1 }, limitRosterRows: { value: 1 }, itemBudgets: { noBudgetMax: 1 } } })).verdict === 'FAIL')
  // 违规 2：幽灵引用必须判红
  ok('违规：文档引用册内不存在的 id → FAIL', R(synCtx({ docRefs: ['zz-not-real'] })).verdict === 'FAIL')
  // 违规 3：核心 id 未被引用必须判红（反向腿）
  ok('违规：核心 id 零引用 → FAIL', R(synCtx({ docRefs: [] })).verdict === 'FAIL')
  // 违规 4：棘轮放宽必须判红（方向相反的反例）
  const loose = JSON.parse(JSON.stringify(SYN_REG))
  loose.volume.indicators[1].thresholds.green = '<=99'
  ok('违规：op-verify-legs 绿档 99 > 实测 42 → FAIL', R(synCtx({ registry: loose })).verdict === 'FAIL')
  // 违规 5：0 字节文档必须判红
  const zero = SYN_DOCS.map((d, i) => (i === 0 ? Object.assign({}, d, { bytes: 0 }) : d))
  ok('违规：文档 0 字节 → FAIL', R(synCtx({ docs: zero })).verdict === 'FAIL')
  // 边界：册内缺键 → UNVERIFIED（rc=2），不得记绿
  const missingKey = R(synCtx({ facts: { a: { v: 1 }, b: { v: 9 }, verifyLegs: { value: 42 }, gateScripts: { value: 1 }, ciJobs: { value: 1 }, limitRosterRows: { value: 1 }, itemBudgets: { noBudgetMax: 1 } } }))
  ok('边界：现算有键而册内缺 → UNVERIFIED', missingKey.verdict === 'UNVERIFIED')
  // 边界：文档条数不足 → FAIL（零输入不得静默 PASS）
  ok('边界：文档只到 2 份 → FAIL', R(synCtx({ docs: SYN_DOCS.slice(0, 2) })).verdict === 'FAIL')
  // 边界：册内源路径取不到 → FAIL
  ok('边界：册内源路径不存在 → FAIL', R(synCtx({ sources: [{ path: 'nope/x.json', bytes: -1 }] })).verdict === 'FAIL')
  // 变异腿 M1：摘掉 F2 的比对（facts 全同）该绿——证明红来自比对而非恒真
  ok('变异 M1：facts 与册一致 → F2 必须 PASS', R(synCtx()).rows.find((r) => r.id === 'F2').pass === true)
  // 变异腿 M2：把一条 manual 指标的 evidence 抽掉 → 必须翻红
  const noEv = JSON.parse(JSON.stringify(SYN_REG))
  delete noEv.volume.indicators[2].source.evidence
  ok('变异 M2：manual 指标缺 evidence → FAIL', R(synCtx({ registry: noEv })).verdict === 'FAIL')
  // 变异腿 M3：把棘轮绿档改回受绑值 → 该绿（证明 M1/棘轮判定不是恒红）
  const okR = JSON.parse(JSON.stringify(SYN_REG))
  okR.volume.indicators[1].thresholds.green = '<=42'
  ok('变异 M3：棘轮绿档采信实测值 → 该绿', R(synCtx({ registry: okR })).verdict === 'PASS')

  // ── 第七十六轮 P2 三腿各自的腿（每条都必须有"正例 + 反例 + 方向相反的一条"）──
  // F10 链A：基线取不到 ⇒ F10 必须 UNVERIFIED（不是绿），且整件 rc=2 —— 盲区不许折成"没有写放大"
  const noBase = R(synCtx({ linkage: { contractDelta: { state: 'unavailable', why: '合成：取不到基线' }, quota: SYN_LINKAGE.quota, addedRows: null, treeClean: true } }))
  ok('F10 反例：联动基线取不到 ⇒ F10 未验（不得折成"本笔无写放大"）', noBase.unverified.includes('F10'))
  // F10 链B/C：余量 red + 本笔有写面变更 ⇒ 双侧命中，必须 rc=1 并点名
  const bothHit = R(synCtx({ linkage: {
    contractDelta: { state: 'ok', baseSha: 'x', newActions: ['A:newWrite'], raised: [] },
    quota: { dailyRows: 100000, callsPerDayAtPeak: 4761, peakRowsWritten: 21, remainingPct: 0.019, red: true },
    addedRows: 21, treeClean: false,
  } }))
  ok('F10 违规：余量 red 且本笔新增写 action ⇒ 双侧命中阻断（rc=1）', bothHit.verdict === 'FAIL' && /双侧同时命中/.test(bothHit.rows.find((r) => r.id === 'F10').detail))
  // F10 方向相反的一条：余量 red 但**本笔无写面变更** ⇒ 只报警不阻断
  const redOnly = R(synCtx({ linkage: { contractDelta: SYN_LINKAGE.contractDelta, quota: { dailyRows: 100000, callsPerDayAtPeak: 4761, peakRowsWritten: 21, remainingPct: 0.019, red: true }, addedRows: 0, treeClean: true } }))
  ok('F10 边界：余量 red 但本笔无写面变更 ⇒ 只报警（该绿）', redOnly.rows.find((r) => r.id === 'F10').pass === true)
  // F11：文档抄了一个与现值不符的数字 ⇒ 必须判红并点名（方向相反的一条：抄的就是现值 ⇒ 该绿）
  const drifted = R(synCtx({ copiedValues: [{ doc: 'docs/governance/README.md', line: 1, label: 'verify 段数', value: 42, actual: 43 }] }))
  ok('F11 违规：文档抄 42 ⇄ 现值 43 ⇒ 判红并点名', drifted.verdict === 'FAIL' && /README\.md:1/.test(drifted.rows.find((r) => r.id === 'F11').detail))
  const equal = R(synCtx({ copiedValues: [{ doc: 'docs/governance/README.md', line: 9, label: 'verify 段数', value: 43, actual: 43 }] }))
  ok('F11 边界：文档抄的就是现值 ⇒ 该绿', equal.rows.find((r) => r.id === 'F11').pass === true)
  // F12：册内声明了消费面而源码没自声明 ⇒ 判红；源码自声明与册内状态集不符 ⇒ 也判红（反向腿）
  const noDecl = R(synCtx({ consumerSrc: { 'op-x-consume': '// 没有自声明\n' } }))
  ok('F12 违规：源码缺 @consumer-states ⇒ 判红', noDecl.verdict === 'FAIL' && /缺 @consumer-states/.test(noDecl.rows.find((r) => r.id === 'F12').detail))
  const wrongStates = R(synCtx({ consumerSrc: { 'op-x-consume': '// @consumer-states: GREEN,RED\n// @consumer-no-line: 不得读成通过\n' } }))
  ok('F12 违规：状态集与册内不符 ⇒ 判红（两条腿都点名）', wrongStates.verdict === 'FAIL' && /状态集不符/.test(wrongStates.rows.find((r) => r.id === 'F12').detail))
  const noConsumer = (() => { const r2 = JSON.parse(JSON.stringify(SYN_REG)); r2.volume.consumers = []; return R(synCtx({ registry: r2, consumerSrc: {} })) })()
  ok('F12 边界：一条消费面都没登记（零消费者）⇒ 判红而不是"没有阈值"', noConsumer.verdict === 'FAIL' && /零消费者/.test(noConsumer.rows.find((r) => r.id === 'F12').detail))
  // 方向相反的一条：把 F12/F10/F11 全摘掉仍须 PASS —— 证明上面那些红不是恒红
  ok('变异 M4：F10/F11/F12 全部正例 ⇒ 该绿（证明三腿不是恒红）', R(synCtx()).verdict === 'PASS')

  const passN = legs.filter(([, v]) => v).length
  for (const [n, v] of legs) console.log((v ? '  OK  ' : '  FAIL') + ' ' + n)
  console.log('governance-framework selftest: ' + passN + '/' + legs.length)
  process.exit(passN === legs.length ? 0 : 1)
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) main().catch((e) => { console.error('[governance-framework] 判据自身异常：' + (e && e.stack ? e.stack : e)); process.exit(1) })
