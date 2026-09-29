#!/usr/bin/env node
// @probe-safe: 骨架实测 rc=2 / 0.124s（账本缺失即在门口判 UNVERIFIED），默认面 rc=0 / 0.108s；以 PATH 前置假 `gh`（命中即写日志并 exit 127）复跑默认面 ⇒ 假 gh 零调用（@2026-09-29 本机），`gh api` 只在显式 `--remote` 分支才走
/**
 * 逃生门计量对账（第五十三轮 E3 / 内层 R53-H5）
 *
 * 一手起因（第五十二轮，本轮复述）：`ci-green-contract.mjs` 在被 `CI_GREEN_SKIP=1` 绕过时印的是
 * 「这笔账会留在 CI 与台账里」，而同一文件 `grep -nE "writeFileSync|appendFile|ledger|\.jsonl"` 实测 **0 命中**
 * ⇒ 那句是**假主张**：理由只活在那一次 push 的 stderr 里，pre-push 的输出不进任何被归档的 run 日志。
 * 对照参照（当次读原文）：`pre-commit/pre-commit` 的 `SKIP`（`pre_commit/commands/run.py:130`）同样**不落盘**，
 * 但它在运行输出里逐钩打 `Skipped`（同文件 156/173 行）——成熟做法至少做到"当场可见"。
 * 本仓必须比它多一步：**把绕过写进版本库**，因为 push 那一刻没人看得见 stderr。
 *
 * 用法：
 *   node scripts/check-escape-hatch-log.mjs              # 真面：读 .ci/escape-hatch.jsonl
 *   node scripts/check-escape-hatch-log.mjs --selftest   # 判据自证（五类合成面，双向）
 *   node scripts/check-escape-hatch-log.mjs --dir <d>    # 指定面（夹具用）
 *
 * 三挡退出码：0 = 账面干净（含"确实零记录"）/ 1 = 有记录不合规 / 2 = 面读不动（不是"没记录"）。
 *
 * 有意**不判**的两件事（写在这里而不是藏在代码里）：
 *  ① 绕过之后远端有没有真的回绿 —— 那要联网查 run，接进阻断链就成了不可自愈的闸（户内规⑩）；
 *     该半只由 `npm run ci:status` / report 面看。
 *  ② base/head sha 在浅克隆里取不到 —— CI 是 `fetch-depth: 1`，据此判红会把 CI 永久锁死；
 *     所以 sha 只做"格式合规"（40 位十六进制）+ 可解析性**建议级**读数。
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-escape-hatch-log.mjs')
export const LEDGER = '.ci/escape-hatch.jsonl'
export const REQUIRED = ['utc', 'base_sha', 'head_sha', 'branch', 'reason', 'actor']
export const MIN_REASON_CHARS = 20
const SHA_RE = /^[0-9a-f]{7,40}$/

/** 纯函数：给定账本行（已按 \n 切好），出逐项判定。不碰磁盘 ⇒ 夹具能合成每条出口。 */
export function evaluate({ lines, facePresent = true }) {
  const rows = []
  if (!facePresent) {
    // 户内 G14 + `tests/cliEntrypoints.test.js` 的空目录 harness：判据在没有输入面时**不得返回 0**。
    // 这里还多一层：账本缺席既可能是"从没绕过"，也可能是"计量根本没接线"—— 两者同形 ⇒ 只能记未验证。
    // 解法是名册侧的 genesis 行（第五十三轮）：起始行由写入器产生并入库，于是"文件不存在"重新变成一条信号。
    rows.push({ id: 'H1', ok: false, unverified: true, detail: `账本不存在（${LEDGER}）⇒ 无法区分"从没绕过"与"计量没接线"，不判通过也不判有绕过` })
    return { rows, rc: 2, stats: { records: 0, bad: 0, face: 'missing' } }
  }
  const recs = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.trim() !== '')
  if (recs.length === 0) {
    rows.push({ id: 'H1', ok: false, unverified: true, detail: '账本存在但 0 条记录 ⇒ 没有对象可判（空文件不能自证计量接过线）' })
    return { rows, rc: 2, stats: { records: 0, bad: 0, face: 'empty' } }
  }
  let bad = 0
  recs.forEach(([ln, text]) => {
    let obj = null
    try { obj = JSON.parse(text) } catch (e) {
      bad += 1
      rows.push({ id: `H2#${ln}`, ok: false, detail: `第 ${ln} 行不是合法 JSON（${e.name}）⇒ 无法审计这次绕过` })
      return
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      bad += 1
      rows.push({ id: `H2#${ln}`, ok: false, detail: `第 ${ln} 行不是对象 ⇒ 逃生门记录必须是键值对（一行一条）` })
      return
    }
    const miss = REQUIRED.filter((k) => !(k in obj) || String(obj[k] ?? '').trim() === '')
    if (miss.length) { bad += 1; rows.push({ id: `H3#${ln}`, ok: false, detail: `第 ${ln} 行缺字段或为空：${miss.join(', ')} ⇒ 这条记录不足以复算"绕过时基座红在哪"` }); return }
    if (String(obj.reason).trim().length < MIN_REASON_CHARS) {
      bad += 1
      rows.push({ id: `H4#${ln}`, ok: false, detail: `第 ${ln} 行理由只有 ${String(obj.reason).trim().length} 字 < ${MIN_REASON_CHARS} ⇒ "理由"不是走过场，要能让人复算当时为什么必须绕` })
      return
    }
    const shaBad = ['base_sha', 'head_sha'].filter((k) => !SHA_RE.test(String(obj[k]).trim()))
    if (shaBad.length) { bad += 1; rows.push({ id: `H5#${ln}`, ok: false, detail: `第 ${ln} 行的 ${shaBad.join('/')} 不是 7–40 位十六进制 ⇒ 指向不了任何提交，等于没记` }); return }
    rows.push({
      id: `H6#${ln}`, ok: true, kind: obj.kind === 'genesis' ? 'genesis' : 'bypass',
      detail: `#${ln} ${obj.utc} base=${String(obj.base_sha).slice(0, 7)}→head=${String(obj.head_sha).slice(0, 7)} branch=${obj.branch} actor=${obj.actor}${obj.backfilled ? '（回溯补记）' : ''}${obj.kind === 'genesis' ? '（起始行，非绕过）' : ''}｜理由 ${String(obj.reason).trim().length} 字`,
    })
  })
  const genesis = rows.filter((x) => x.kind === 'genesis').length
  return { rows, rc: bad ? 1 : 0, stats: { records: recs.length, bad, genesis, bypass: recs.length - genesis, face: 'present' } }
}

/**
 * 纯函数：从账本行里取出**绕过**记录的 head_sha（`kind:"genesis"` 的起始行不是绕过，不参与远端对账）。
 * 坏行在这里静默跳过是安全的：那些行已由 `evaluate` 的 H2/H3/H5 具名判红，本函数只负责喂给远端腿。
 */
export function bypassHeads(lines = []) {
  const out = []
  lines.forEach((text, i) => {
    if (!text || !text.trim()) return
    let o = null
    try { o = JSON.parse(text) } catch { return }
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.kind === 'genesis') return
    const h = String(o.head_sha ?? '').trim()
    if (SHA_RE.test(h)) out.push({ line: i + 1, head: h, branch: String(o.branch ?? '').trim() })
  })
  return out
}

/**
 * 第五十四轮 R54-H3：绕过**之后**远端到底绿没绿 —— report-only，永不改退出码。
 *
 * 为什么不能进阻断链：这一腿要联网查 run，网络不通时它会把一次正常的提交判红，而本地没有任何
 * 可自愈的处置（户内规⑩：一次正常提交变不了绿的判据没资格当闸）。所以第五十三轮把它记成
 * "没判的半边"；本轮补的是**取证通道**而不是闸：查得到就逐条点名，查不到就印 UNVERIFIED，
 * 两种形态都不影响 `verify:escape-hatch` 的 rc。
 *
 * `fetchRuns(sha)` 由调用方注入 ⇒ 夹具喂合成 payload，绝不在测试里联网。
 *   返回数组        ⇒ 参与对账
 *   返回 null       ⇒ 取数失败（gh 不可用 / 网络 / rc≠0）
 *   抛异常          ⇒ 同上，状态记 UNVERIFIED 并带上原因
 */
export function remoteRows(records = [], fetchRuns = () => null) {
  return records.map((rec) => {
    let runs = null
    let why = ''
    try { runs = fetchRuns(rec.head) } catch (e) { why = `${e.name || 'Error'}: ${e.message}` }
    const short = rec.head.slice(0, 7)
    if (runs === null || runs === undefined) {
      return { id: `R#${rec.line}`, state: 'UNVERIFIED', ok: false, unverified: true,
        detail: `#${rec.line} head=${short} ⇒ 远端取不到${why ? `（${why}）` : ''}；**这不等于没回绿**，也不等于没绕过` }
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      return { id: `R#${rec.line}`, state: 'NOTFOUND', ok: false, unverified: true,
        detail: `#${rec.line} head=${short} ⇒ 该 sha 名下没有任何 run（分支被删/sha 不属于本仓/浅克隆外推）` }
    }
    const done = runs.filter((r) => (r.status || '') === 'completed')
    const failed = done.filter((r => (r.conclusion || '') === 'failure'))
    const passed = done.filter((r) => (r.conclusion || '') === 'success')
    const running = runs.length - done.length
    const state = failed.length ? 'RED' : (running > 0 ? 'PENDING' : (passed.length > 0 ? 'GREEN' : 'OTHER'))
    return { id: `R#${rec.line}`, state, ok: state === 'GREEN', unverified: false,
      detail: `#${rec.line} head=${short} branch=${rec.branch || '?'}｜run ${runs.length} 条：success ${passed.length}／failure ${failed.length}／未结束 ${running}`
        + (failed.length ? `（${failed.map((f) => f.name || '?').slice(0, 3).join(', ')}）` : '') }
  })
}

function selftest() {
  const good = JSON.stringify({ utc: '2026-01-01T00:00:00Z', base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), branch: 'main', reason: '基座判红且不可自愈，本笔正是那条修复，只能叠加推送', actor: 'tester' })
  const cases = [
    ['① 正向：字段齐全的一条 ⇒ rc=0 并逐条读数', { lines: [good], facePresent: true }, (r) => r.rc === 0 && r.stats.records === 1 && r.rows.some((x) => x.id === 'H6#1')],
    ['② 反例：坏 JSON ⇒ rc=1 且点名行号', { lines: ['{ 这不是 JSON'], facePresent: true }, (r) => r.rc === 1 && r.rows.some((x) => x.id === 'H2#1' && x.detail.includes('第 1 行'))],
    ['③ 反例：缺 head_sha ⇒ rc=1 且说出缺哪个字段', { lines: [good.replace(/"head_sha":"[^"]*"/, '"head_sha": ""')], facePresent: true }, (r) => r.rc === 1 && r.rows.some((x) => x.detail.includes('head_sha'))],
    ['④ 反例：理由只有八个字 ⇒ rc=1（"理由"不是装饰）', { lines: [JSON.stringify({ ...JSON.parse(good), reason: '基座红了' })], facePresent: true }, (r) => r.rc === 1 && r.rows.some((x) => x.id.startsWith('H4'))],
    ['⑤ 零输入第一态：文件不存在 ⇒ rc=2（没面可判不等于清白）',
      { lines: [], facePresent: false }, (r) => r.rc === 2 && r.stats.face === 'missing' && r.rows[0].detail.includes('无法区分')],
    ['⑥ 零输入第二态：文件在、0 行 ⇒ 同样 rc=2，措辞与⑤不同形',
      { lines: ['', '  '], facePresent: true }, (r) => r.rc === 2 && r.stats.face === 'empty' && r.rows[0].detail.includes('没有对象可判')],
  ]
  let bad = 0
  for (const [label, input, check] of cases) {
    let ok = false
    let note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note}`)
  }
  // —— R54-H3 的远端腿：fetchRuns 一律注入合成 payload，**自证面里不许联网**。
  const rec = (head) => [{ line: 1, head, branch: 'main' }]
  const remoteCases = [
    ['⑦ 远端正向：sha 名下有 success run ⇒ 状态 GREEN 且印出 matched/passed 两个计数',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'success' }]); return x[0].state === 'GREEN' && /run 1 条：success 1/.test(x[0].detail) }, true],
    ['⑧ 远端反例：同 sha 有一条 failure ⇒ RED 并点名是哪个 job/workflow',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'success' }, { name: 'D1 Daily Backup', status: 'completed', conclusion: 'failure' }]); return x[0].state === 'RED' && x[0].detail.includes('D1 Daily Backup') }, true],
    ['⑨ 远端零输入：fetchRuns 返回 null ⇒ UNVERIFIED，**措辞必须两边都不下**（既不说绿也不说没绕）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => null); return x[0].state === 'UNVERIFIED' && x[0].unverified === true && x[0].detail.includes('不等于没回绿') }, true],
    ['⑩ 远端形态：run 还在跑 ⇒ PENDING（不得提前判绿，也不得判红）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'in_progress', conclusion: '' }]); return x[0].state === 'PENDING' }, true],
    ['⑪ 变异体面：恒 GREEN 的实现会在⑧上翻红 ⇒ 若有人把状态改成写死，这条自证当场抓到',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'x', status: 'completed', conclusion: 'failure' }]); return x[0].state !== 'GREEN' }, true],
  ]
  let rbad = 0
  for (const [label, check] of remoteCases) {
    let ok = false
    let note = ''
    try { ok = check() === true } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) rbad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note}`)
  }
  const total = cases.length + remoteCases.length
  console.log(`[verify:escape-hatch] 自证 ${total - bad - rbad}/${total}（账本 ${cases.length - bad}/${cases.length}・远端腿 ${remoteCases.length - rbad}/${remoteCases.length}）${bad + rbad ? ' ⇒ 有腿没咬住' : ''}`)
  return (bad + rbad) ? 1 : 0
}

/** 取该 sha 名下的 run 列表；任何一步不成都返回 null（⇒ 上层记 UNVERIFIED，不猜结论）。 */
function ghRuns(sha) {
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 })
  if (url.status !== 0) return null
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec((url.stdout || '').trim())
  if (!m) return null
  const r = spawnSync('gh', ['api',
    `repos/${m[1]}/${m[2]}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=50`,
    '--jq', '[.workflow_runs[] | {name, status, conclusion}]'],
  { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) return null
  try { return JSON.parse(r.stdout) } catch { return null }
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const di = argv.indexOf('--dir')
  const dir = di >= 0 && argv[di + 1] ? resolve(argv[di + 1]) : ROOT
  const p = join(dir, LEDGER)
  let text = null
  let readErr = null
  if (existsSync(p)) {
    try { text = readFileSync(p, 'utf8') } catch (e) { readErr = `${e.code || e.name}: ${e.message}` }
  }
  if (readErr) {
    console.log(`[verify:escape-hatch] UNVERIFIED 账本读不动（${LEDGER}：${readErr}）⇒ 不据"我没读到"判通过，也不判有绕过`)
    return 2
  }
  const r = evaluate({ lines: text === null ? [] : text.split(/\r?\n/), facePresent: text !== null })
  for (const row of r.rows) console.log(`${row.ok ? 'PASS' : (row.unverified ? 'UNVERIFIED' : 'FAIL')}  ${row.id} :: ${row.detail}`)
  console.log(`[verify:escape-hatch] verdict=${r.rc === 1 ? 'RED' : (r.rc === 2 ? 'UNVERIFIED' : 'GREEN')} rc=${r.rc}｜面=${r.stats.face}｜记录 ${r.stats.records} 条（绕过 ${r.stats.bypass ?? 0} / 起始 ${r.stats.genesis ?? 0}）｜不合规 ${r.stats.bad}｜检查 ${r.rows.length}/${r.rows.length}`)
  console.log('  未判的半边（不得当成已判）：绕过之后远端有没有回绿——离线面判不了，取证通道是 `--remote`（report-only，见下）；另 sha 在浅克隆里能否解出（CI fetch-depth=1）也不判。')
  if (argv.includes('--remote')) {
    const heads = bypassHeads(text === null ? [] : text.split(/\r?\n/))
    console.log(`[report:escape-hatch-remote] report-only（**不改 rc，也不进阻断链**）：账本里 ${heads.length} 条绕过记录待对账`)
    for (const row of remoteRows(heads, ghRuns)) console.log(`  ${row.state}  ${row.id} :: ${row.detail}`)
    console.log('  为什么不做成闸：这条腿要联网，网络不通时它会把一次正常提交判红，而本机没有任何可自愈的处置（户内规⑩）。')
    console.log('  为什么仍值得跑：第五十二轮那次绕过，"绕过之后到底绿没绿"当时是**没人查过**的——本行把"查一次"变成一条命令。')
  }
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) {
  process.exit(main())
}

// 供夹具直接调用（按仓内既有写法：入口守卫已在上方判过，import 不会触发 main）
export { pathToFileURL }
