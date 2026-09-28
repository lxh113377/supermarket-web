#!/usr/bin/env node
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
  console.log(`[verify:escape-hatch] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
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
  console.log('  未判的半边（不得当成已判）：绕过之后远端有没有回绿（要联网查 run，接进阻断链即不可自愈）；sha 在浅克隆里能否解出（CI fetch-depth=1）。')
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) {
  process.exit(main())
}

// 供夹具直接调用（按仓内既有写法：入口守卫已在上方判过，import 不会触发 main）
export { pathToFileURL }
