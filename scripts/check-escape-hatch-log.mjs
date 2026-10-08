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
 *   node scripts/check-escape-hatch-log.mjs                    # 真面：读 .ci/escape-hatch.jsonl + C9 终态读数对账
 *   node scripts/check-escape-hatch-log.mjs --selftest         # 判据自证（合成面，双向）
 *   node scripts/check-escape-hatch-log.mjs --dir <d>          # 指定面（夹具用）
 *   node scripts/check-escape-hatch-log.mjs --remote           # 逐条联网读终态（report-only，不落盘）
 *   node scripts/check-escape-hatch-log.mjs --update-remote    # 联网读终态**并落** docs/escape-hatch-remote.json
 *   node scripts/check-escape-hatch-log.mjs --require-covered  # 升档演习：未覆盖/死读数 ⇒ rc=2（默认不开）
 *
 * 三挡退出码：0 = 账面干净（含"确实零记录"）/ 1 = 有记录不合规 / 2 = 面读不动（不是"没记录"）。
 *
 * 有意**不判**的两件事（写在这里而不是藏在代码里）：
 *  ① 绕过之后远端有没有真的回绿 —— 那要联网查 run，接进阻断链就成了不可自愈的闸（户内规⑩）；
 *     该半只由 `npm run ci:status` / report 面看。**但"不判"不等于"不记"**：第七十二轮起，
 *     查过的终态落 `docs/escape-hatch-remote.json`，默认每次跑都做一次 C9 双向对账（未覆盖 N 条 /
 *     死读数 M 条），升档开关 `--require-covered` 缺省不开。
 *  ② base/head sha 在浅克隆里取不到 —— CI 是 `fetch-depth: 1`，据此判红会把 CI 永久锁死；
 *     所以 sha 只做"格式合规"（40 位十六进制）+ 可解析性**建议级**读数。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-escape-hatch-log.mjs')
export const LEDGER = '.ci/escape-hatch.jsonl'
export const REMOTE_DOC = 'docs/escape-hatch-remote.json'
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
 * 第五十四轮 R54-H3 + 第七十二轮 G-72-2：绕过**之后**远端到底绿没绿 —— report-only，永不改退出码。
 *
 * 为什么不能进阻断链：这一腿要联网查 run，网络不通时它会把一次正常的提交判红，而本地没有任何
 * 可自愈的处置（户内规⑩：一次正常提交变不了绿的判据没资格当闸）。所以第五十三轮把它记成
 * "没判的半边"；本轮补的是**取证通道**而不是闸：查得到就逐条点名，查不到就印 UNVERIFIED，
 * 两种形态都不影响 `verify:escape-hatch` 的 rc。
 *
 * ── 第七十二轮修的那一半：**判决面此前没被限定，导致假红** ──
 * 原实现把该 sha 名下**所有 workflow** 的 run 混在一起数，`failed.length ? 'RED'`。
 * 一手（ecdc92d，账本第 12 条）：它的 `CI` run 37228542182 = **success**、Release parity 37228744546 = success，
 * 而 `D1 Daily Backup`（37241500391 / 37397785726）与 `Uptime`（37272967991 / 37428097178）红 ——
 * 那两条是**cron 链缺 `CF_D1_BACKUP_TOKEN`** 这一支在红，与"这次绕过之后 CI 有没有绿"毫无关系，
 * 却把这条绕过标成了 RED。后果不是"多报一个红"，是**10 条 RED 里混着无法处置的假红，
 * 于是整个 RED 列表没人再看** —— 与第 71 轮"过期了也没人知道"同族的第二种沉默。
 *
 * 修法（derive-not-duplicate）：判决只认 `.ci/contract.json` 的 `workflow` 字段（当前 = `CI`）名下那些 run；
 * 其余 workflow 的红**照样印**，但降级为"旁证"，不进判决。
 * 为什么选它当真相源：这份契约本来就是"哪些 job 算这次交付的全绿"的唯一权威，
 * 用它来限定"这次绕过算不算绿"是同一个问题第二次问同一份答案，不新建第二真相源。
 *
 * `fetchRuns(sha)` 由调用方注入 ⇒ 夹具喂合成 payload，绝不在测试里联网。
 *   返回数组        ⇒ 参与对账
 *   返回 null       ⇒ 取数失败（gh 不可用 / 网络 / rc≠0）
 *   抛异常          ⇒ 同上，状态记 UNVERIFIED 并带上原因
 *
 * @param {Array} records
 * @param {(sha:string)=>Array|null} fetchRuns
 * @param {{workflow?: string}} [opts] scope.workflow = 判决面 workflow 名；缺省 'CI'
 */
export function remoteRows(records = [], fetchRuns = () => null, opts = {}) {
  const scopeName = opts.workflow || 'CI'
  return records.map((rec) => {
    let runs = null
    let why = ''
    try { runs = fetchRuns(rec.head) } catch (e) { why = `${e.name || 'Error'}: ${e.message}` }
    const short = rec.head.slice(0, 7)
    if (runs === null || runs === undefined) {
      return { id: `R#${rec.line}`, head: rec.head, state: 'UNVERIFIED', ok: false, unverified: true,
        detail: `#${rec.line} head=${short} ⇒ 远端取不到${why ? `（${why}）` : ''}；**这不等于没回绿**，也不等于没绕过` }
    }
    if (!Array.isArray(runs) || runs.length === 0) {
      return { id: `R#${rec.line}`, head: rec.head, state: 'NOTFOUND', ok: false, unverified: true,
        detail: `#${rec.line} head=${short} ⇒ 该 sha 名下没有任何 run（分支被删/sha 不属于本仓/浅克隆外推）` }
    }
    // 判决面：只取 scopeName 名下的 run；旁证面：其余 workflow 的 run。
    const nameOf = (r) => String(r.name || '').trim()
    const scoped = runs.filter((r) => nameOf(r) === scopeName)
    const others = runs.filter((r) => nameOf(r) !== scopeName)
    const doneOf = (list) => list.filter((r) => (r.status || '') === 'completed')
    const failedOf = (list) => doneOf(list).filter((r) => (r.conclusion || '') === 'failure')
    const passedOf = (list) => doneOf(list).filter((r) => (r.conclusion || '') === 'success')
    const runningOf = (list) => list.filter((r) => (r.status || '') !== 'completed')

    // 旁证照印不进判决：点名到 workflow 粒度，让读的人知道"红的是哪条链"。
    const otherRed = failedOf(others)
    const side = otherRed.length
      ? `｜旁证（非判决面）：${[...new Set(otherRed.map(nameOf))].join('、')} 红 ${otherRed.length} 条 —— 与「${scopeName} 有没有绿」无关，不计入判决`
      : ''

    if (!scoped.length) {
      // 判决面一个 run 都没有：不能说绿（没人跑过），也不能说红（没跑 ≠ 跑红）。
      // 措辞两边都不下，与 UNVERIFIED 同族但成因不同，单独一个状态便于台账分辨。
      return { id: `R#${rec.line}`, head: rec.head, state: 'NOVERDICT', ok: false, unverified: true, scope: scopeName,
        detail: `#${rec.line} head=${short} ⇒ 该 sha 名下没有任何名为「${scopeName}」的 run（另有 ${others.length} 条别的 workflow）${side}；这不等于没回绿` }
    }
    const sDone = doneOf(scoped)
    const sFailed = failedOf(scoped)
    const sPassed = passedOf(scoped)
    const sCancelled = sDone.filter((r) => (r.conclusion || '') === 'cancelled')
    const sRunning = runningOf(scoped).length
    // `cancelled` 必须单列成一个命名状态，不能和"其它"混在一起。
    // 一手（第七十二轮 G-72-1）：run 37677572509 的 e2e / e2e-cloud-stub 各卡 6 小时后被
    // GitHub 作业硬上限 cancelled ⇒ CI 终态 cancelled。这是"CI 从来没给出结论"，
    // 与 GREEN / RED 都不同；旧实现把它落进 `OTHER`，读的人看不出这 6 条正是本轮要治的那个病。
    // 它进 C10 的 unknown 分母而不是 open 分母 —— 「没跑完」不是「谁欠一笔处置」。
    const state = sFailed.length ? 'RED'
      : (sRunning > 0 ? 'PENDING'
        : (sCancelled.length && !sPassed.length ? 'CANCELLED'
          : (sPassed.length > 0 ? 'GREEN' : 'OTHER')))
    return { id: `R#${rec.line}`, head: rec.head, state, ok: state === 'GREEN', unverified: state !== 'GREEN' && state !== 'RED', scope: scopeName,
      failingRuns: sFailed.map((f) => nameOf(f)).slice(0, 5),
      cancelledRuns: sCancelled.length,
      sideRed: [...new Set(otherRed.map(nameOf))],
      detail: `#${rec.line} head=${short} branch=${rec.branch || '?'}｜判决面「${scopeName}」${scoped.length} 条：success ${sPassed.length}／failure ${sFailed.length}／cancelled ${sCancelled.length}／未结束 ${sRunning}`
        + (sFailed.length ? `（${[...new Set(sFailed.map(nameOf))].slice(0, 3).join(', ')}）` : '')
        + (state === 'CANCELLED' ? `｜**CI 从来没给出结论**（被平台作业上限掐断）⇒ 不算绿也不算红，不据此记谁欠账` : '')
        + side }
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
    ['⑦ 远端正向：判决面 CI success ⇒ GREEN，且分母只数判决面',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'success' }]); return x[0].state === 'GREEN' && /判决面「CI」1 条：success 1/.test(x[0].detail) }, true],
    // ⑧ 已于第七十二轮**改判**：原断言是「同 sha 任一 workflow failure ⇒ RED」，那正是本轮修掉的假红。
    // 一手 ecdc92d：CI success，而 D1 Daily Backup / Uptime 红（缺 CF_D1_BACKUP_TOKEN 那一支），
    // 却被标成 RED。现在判决只认判决面，别的 workflow 降级为旁证且必须被点名（不许静默吞掉）。
    ['⑧ 远端反例（已改判）：判决面 CI 绿 + 旁证 D1 Daily Backup 红 ⇒ 仍 GREEN，但 detail 必须点名旁证',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'success' }, { name: 'D1 Daily Backup', status: 'completed', conclusion: 'failure' }]); return x[0].state === 'GREEN' && x[0].detail.includes('旁证') && x[0].detail.includes('D1 Daily Backup') && x[0].sideRed.includes('D1 Daily Backup') }, true],
    ['⑨ 远端零输入：fetchRuns 返回 null ⇒ UNVERIFIED，**措辞必须两边都不下**（既不说绿也不说没绕）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => null); return x[0].state === 'UNVERIFIED' && x[0].unverified === true && x[0].detail.includes('不等于没回绿') }, true],
    ['⑩ 远端形态：判决面还在跑 ⇒ PENDING（不得提前判绿，也不得判红）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'in_progress', conclusion: '' }]); return x[0].state === 'PENDING' }, true],
    ['⑪ 变异体面：恒 GREEN 的实现会在⑬上翻红 ⇒ 若有人把状态改成写死，这条自证当场抓到',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'failure' }]); return x[0].state !== 'GREEN' }, true],
    ['⑰ 判决面红 ⇒ RED 且带 failingRuns（这是 C10 要接的那一半，必须点得出是哪条链）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'failure' }, { name: 'Uptime', status: 'completed', conclusion: 'success' }]); return x[0].state === 'RED' && Array.isArray(x[0].failingRuns) && x[0].failingRuns.includes('CI') }, true],
    ['⑱ 判决面一个 run 都没有 ⇒ NOVERDICT 而非 GREEN/RED（没跑 ≠ 跑绿，也 ≠ 跑红）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'Dispatch deploy to github.io', status: 'completed', conclusion: 'success' }]); return x[0].state === 'NOVERDICT' && x[0].unverified === true && !x[0].ok }, true],
    ['⑲ 判决面名可注入（不写死 CI）：scope 换成别的 workflow 时判决跟着换',
      () => { const runs = [{ name: 'Alpha', status: 'completed', conclusion: 'failure' }, { name: 'CI', status: 'completed', conclusion: 'success' }]; const a = remoteRows(rec('b'.repeat(40)), () => runs, { workflow: 'CI' })[0]; const b = remoteRows(rec('b'.repeat(40)), () => runs, { workflow: 'Alpha' })[0]; return a.state === 'GREEN' && b.state === 'RED' }, true],
    ['⑳ 判决面被 cancelled ⇒ 必须单列 CANCELLED，且措辞说清「不是绿也不是红」（G-72-1 那一类不许藏进 OTHER）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'cancelled' }])[0]; return x.state === 'CANCELLED' && x.ok === false && x.unverified === true && x.cancelledRuns === 1 && /从来没给出结论/.test(x.detail) && x.detail.includes('不算绿也不算红') }, true],
    ['㉖ 混面：判决面 cancelled 但另有一次 success ⇒ GREEN（不因一次掐断就否认已绿）',
      () => { const x = remoteRows(rec('b'.repeat(40)), () => [{ name: 'CI', status: 'completed', conclusion: 'cancelled' }, { name: 'CI', status: 'completed', conclusion: 'success' }])[0]; return x.state === 'GREEN' }, true],
  ]
  // —— 第七十二轮 C9：终态读数 ⇄ 账本绕过 的双向差集（不联网、不取墙上时钟）
  const c9Cases = [
    ['⑫ C9 正向：账本每条绕过都有读数 ⇒ COVERED，且未覆盖/死读数两个分母都是 0',
      () => { const x = reconcileRemote({ heads: [{ head: 'aaaa1111' }, { head: 'bbbb2222' }], doc: { generatedUtc: 'T', rows: [{ head: 'AAAA1111' }, { head: 'bbbb2222' }] } }); return x.state === 'COVERED' && x.uncovered === 0 && x.stale === 0 }, true],
    ['⑬ C9 反例：账本新加一条绕过而读数没跟 ⇒ DRIFT 且未覆盖=1（"有读数"不等于"读数盖住了"）',
      () => { const x = reconcileRemote({ heads: [{ head: 'aaaa1111' }, { head: 'cccc3333' }], doc: { generatedUtc: 'T', rows: [{ head: 'aaaa1111' }] } }); return x.state === 'DRIFT' && x.uncovered === 1 && x.rows.includes('cccc3333') }, true],
    ['⑭ C9 反例：读数里有账本已不存在的 head ⇒ 死读数=1（册子不许只进不出，与 D5「基线死行」同规）',
      () => { const x = reconcileRemote({ heads: [{ head: 'aaaa1111' }], doc: { generatedUtc: 'T', rows: [{ head: 'aaaa1111' }, { head: 'dddd9999' }] } }); return x.state === 'DRIFT' && x.stale === 1 }, true],
    ['⑮ C9 零输入：读数不在 ⇒ UNVERIFIED 且措辞两边都不下（既不说绿也不说没绕过）',
      () => { const x = reconcileRemote({ heads: [{ head: 'aaaa1111' }, { head: 'bbbb2222' }], doc: null }); return x.state === 'UNVERIFIED' && x.uncovered === 2 && x.detail.includes('无人查过') && !x.detail.includes('没回绿') }, true],
    ['⑯ C9 变异体：把"未覆盖"写死成 0 的实现会在⑬上翻红 ⇒ 自证有牙',
      () => { const x = reconcileRemote({ heads: [{ head: 'aaaa1' }, { head: 'bbbb2' }], doc: { rows: [{ head: 'aaaa1' }] } }); return x.uncovered !== 0 }, true],
  ]
  // —— 第七十二轮 C10：判决面红了的绕过，后来有没有被处置过（"覆盖"不等于"有结论"）
  const c10Cases = [
    ['⑳ C10 正向：判决面全绿 ⇒ CLOSED，无待补偿（此时不该有任何解释义务）',
      () => { const x = reconcileDisposition({ rows: [{ state: 'GREEN' }, { state: 'GREEN' }] }); return x.state === 'CLOSED' && x.open === 0 }, true],
    ['㉑ C10 正向：判决面红但每条都带可证伪解释 ⇒ EXPLAINED，待补偿=0',
      () => { const x = reconcileDisposition({ rows: [{ state: 'RED', disposition: { why: 'run 36999505316 job e2e failure 真实原因见 CHANGELOG 第 32 轮', until: '' } }] }); return x.state === 'EXPLAINED' && x.open === 0 }, true],
    ['㉒ C10 反例：判决面红且无解释 ⇒ OPEN 且逐条点名（这是本轮要治的那一半）',
      () => { const x = reconcileDisposition({ rows: [{ state: 'RED' }] }); return x.state === 'OPEN' && x.open === 1 && x.rows[0].why.includes('没有处置结论') }, true],
    ['㉓ C10 反例：解释写成"已知/待观察/以后再说"这类不可证伪的话 ⇒ 仍判 OPEN（长度不算数，要可证伪）',
      () => { const x = reconcileDisposition({ rows: [{ state: 'RED', disposition: { why: '已知问题待观察'.padEnd(40, ' ') } }] }); return x.state === 'OPEN' }, true],
    ['㉔ C10 形态：非 RED 状态（NOVERDICT / UNVERIFIED / NOTFOUND / PENDING / CANCELLED）不进 OPEN 分母 —— 没取到或没跑完不是谁欠账',
      () => { const x = reconcileDisposition({ rows: [{ state: 'NOVERDICT' }, { state: 'UNVERIFIED' }, { state: 'NOTFOUND' }, { state: 'PENDING' }, { state: 'CANCELLED' }] }); return x.state === 'CLOSED' && x.open === 0 && x.unknown === 5 }, true],
    ['㉕ C10 变异体：把 open 写死成 0 的实现会在㉒上翻红 ⇒ 自证有牙',
      () => { const x = reconcileDisposition({ rows: [{ state: 'RED' }, { state: 'RED' }] }); return x.open === 2 }, true],
  ]
  let rbad = 0
  for (const [label, check] of [...remoteCases, ...c9Cases, ...c10Cases]) {
    let ok = false
    let note = ''
    try { ok = check() === true } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) rbad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note}`)
  }
  const total = cases.length + remoteCases.length + c9Cases.length + c10Cases.length
  console.log(`[verify:escape-hatch] 自证 ${total - bad - rbad}/${total}（账本 ${cases.length - bad}/${cases.length}・远端腿 ${remoteCases.length + c9Cases.length + c10Cases.length - rbad}/${remoteCases.length + c9Cases.length + c10Cases.length}）${bad + rbad ? ' ⇒ 有腿没咬住' : ''}`)
  return (bad + rbad) ? 1 : 0
}

/**
 * 判决面 = `.ci/contract.json` 的 `workflow` 字段。读不到就用 'CI'（并在 C10 行显式印出判决面，
 * 让「契约改名了」这件事永远藏不住）。
 * 为什么不另设一个 `scopeWorkflow` 配置项：那份契约本来就是「哪些 job 算这次交付全绿」的唯一权威，
 * 用它来限定「这次绕过算不算绿」是同一个问题第二次问同一份答案；再加一个配置项就是第二真相源。
 */
export function scopeWorkflow() {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, '.ci', 'contract.json'), 'utf8'))
    return String(j.workflow || '').trim() || 'CI'
  } catch { return 'CI' }
}

/** 取该 sha 名下的 run 列表；任何一步不成就返回 null（⇒ 上层记 UNVERIFIED，不猜结论）。 */
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

/**
 * 第七十二轮 C9：绕过之后的**终态读数有没有盖住整本账** —— 默认 report-only，`--require-covered` 才升档。
 *
 * 为什么需要它：`--remote` 这条取证通道自第 54 轮就存在，但它**只往 stdout 印一次**，
 * 谁跑过、跑到第几条、哪条至今没有终态，仓里查不到（一手：本轮实测账本 28 条里 9 条 RED，
 * 而这些 RED 上一轮的报告里一个字都没写过）。判据说"未判的半边"是对的，但"未判"本身也成了一个
 * 没人再看的状态 —— 这与第 71 轮 C7 的病同族：字段有写无读 / 通道有跑无账。
 *
 * 取数口径**不取墙上时钟**（本仓在册口径：无墙钟的缺省判链）：
 *   未覆盖 = 账本里的绕过 head 集合 − 读数里的 head 集合
 *   死读数 = 读数里的 head 集合 − 账本里的绕过 head 集合
 * 两个方向各出一行分母，缺任一边都不许写"已对账"。
 *
 * @param {{heads: Array<{head:string}>, doc: null|{rows?: Array<{head:string}>}}} input
 */
export function reconcileRemote ({ heads, doc }) {
  const live = new Set(heads.map((h) => String(h.head || '').toLowerCase()))
  if (!doc) {
    return { state: 'UNVERIFIED', uncovered: live.size, stale: 0, rows: [],
      detail: `读数不在（docs/escape-hatch-remote.json 取不到）⇒ 账本里 ${live.size} 条绕过的终态**无人查过**，这不等于没问题` }
  }
  const read = new Set((doc.rows || []).map((x) => String(x.head || '').toLowerCase()))
  const uncovered = [...live].filter((x) => !read.has(x))
  const stale = [...read].filter((x) => !live.has(x))
  const state = uncovered.length || stale.length ? 'DRIFT' : 'COVERED'
  return { state, uncovered: uncovered.length, stale: stale.length, rows: [...uncovered, ...stale], readRows: (doc.rows || []).length,
    detail: `读数 ${(doc.generatedUtc || '无时刻')}｜在册 ${read.size} 条 ⇄ 账本绕过 ${live.size} 条｜未覆盖 ${uncovered.length}｜死读数 ${stale.length}` }
}

/**
 * 第七十二轮 C10：**判决面红了的绕过，后来有没有被处置过。**
 *
 * C9 与 C10 的分工（本轮踩出来的界，两者缺一不可）：
 *   C9 = 覆盖性：「读数有没有盖住整本账」（未覆盖 / 死读数 两个分母）。
 *   C10 = 结论性：「盖住的那几条，判决面红的有没有处置结论」。
 * 只立 C9 会出现一种很坏的绿：账本被读数 100% 覆盖、verdict=GREEN，而读数里躺着 9~10 条 RED
 * （本轮实测 GREEN 17／RED 10）。**覆盖不等于办完了** —— 这与第 71 轮 C7 那条
 * 「登记册读数过期了也没人知道」是同族沉默的第二个变种。
 *
 * 分母口径（三条都要印，缺一条就会被读成"全清了"）：
 *   open    = 判决面 RED 且没有合格处置结论的条数
 *   unknown = 非 GREEN 且非 RED 的条数（NOVERDICT / UNVERIFIED / NOTFOUND / PENDING）
 *            —— **不进 open**：没取到不是谁欠账，把它算进欠账就会逼人编解释
 *   explained = 判决面 RED 但带了合格解释的条数
 *
 * 「合格解释」的可证伪判法（复用 `verify:registry` R5 的口径：理由必须含实测数字或可复跑命令）：
 *   ① 长度 ≥ MIN_DISPOSITION_CHARS（与账本 `reason` 同一把尺，不给解释开口下限）；
 *   ② 含**可复算标记**——反引号命令、run 号（8+ 位数字）、或 `\d` 数字之一；
 *   ③ 含到期时刻 `until` 时不得早于"今天"——本仓不取墙上时钟（见 C9 注），
 *      故这一条由 `--require-disposition` 之外的人工闸负责，本函数只判 ①② 与 `until` 的**格式**。
 *   「已知问题待观察」「以后再说」「已知的」这类话过不了 ②：它们一个数字一个命令都没有。
 *
 * @param {{rows: Array<{state:string, head?:string, disposition?:{why?:string, until?:string}}>}} input
 */
export const MIN_DISPOSITION_CHARS = 20
/** 可复算标记：反引号命令 / 8+ 位 run 号 / 任意数字。 */
const FALSIFIABLE_RE = /`[^`]+`|\b\d{8,}\b|\d/

export function reconcileDisposition ({ rows }) {
  const list = Array.isArray(rows) ? rows : []
  const open = []
  let explained = 0
  let unknown = 0
  for (const r of list) {
    const st = String(r.state || '').toUpperCase()
    if (st === 'GREEN' || st === 'OTHER') continue
    if (st !== 'RED') { unknown += 1; continue }
    const why = String(r?.disposition?.why ?? '').trim()
    const until = String(r?.disposition?.until ?? '').trim()
    const whyOk = why.length >= MIN_DISPOSITION_CHARS && FALSIFIABLE_RE.test(why)
    const untilOk = !until || /^\d{4}-\d{2}-\d{2}$/.test(until)
    if (whyOk && untilOk) { explained += 1; continue }
    const short = String(r.head || r.id || '?').slice(0, 10)
    open.push({
      head: short,
      why: !whyOk && !why
        ? `${short} 判决面 RED（${(r.failingRuns || []).join(', ') || '判决面 CI'}）⇒ **没有处置结论**：红过的事没人认领，也没人写它后来怎么了`
        : !whyOk
          ? `${short} 判决面 RED ⇒ 处置结论不可证伪（${why.length} 字${why.length < MIN_DISPOSITION_CHARS ? ` < ${MIN_DISPOSITION_CHARS}` : ''}、${FALSIFIABLE_RE.test(why) ? '有' : '无'}可复算标记）：「${why.slice(0, 40)}」`
          : `${short} 判决面 RED ⇒ 处置结论的 until 格式非法（实得「${until}」，要 YYYY-MM-DD 或留空）`,
    })
  }
  const state = open.length ? 'OPEN' : (explained ? 'EXPLAINED' : 'CLOSED')
  return { state, open: open.length, explained, unknown, rows: open,
    detail: `判决面 RED 待处置 ${open.length}｜RED 已解释 ${explained}｜判决面没给结论（NOVERDICT/UNVERIFIED/NOTFOUND/PENDING/CANCELLED，不算欠账）${unknown}` }
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
  const lines = text === null ? [] : text.split(/\r?\n/)
  const r = evaluate({ lines, facePresent: text !== null })
  for (const row of r.rows) console.log(`${row.ok ? 'PASS' : (row.unverified ? 'UNVERIFIED' : 'FAIL')}  ${row.id} :: ${row.detail}`)
  console.log(`[verify:escape-hatch] verdict=${r.rc === 1 ? 'RED' : (r.rc === 2 ? 'UNVERIFIED' : 'GREEN')} rc=${r.rc}｜面=${r.stats.face}｜记录 ${r.stats.records} 条（绕过 ${r.stats.bypass ?? 0} / 起始 ${r.stats.genesis ?? 0}）｜不合规 ${r.stats.bad}｜检查 ${r.rows.length}/${r.rows.length}`)
  console.log('  未判的半边（不得当成已判）：绕过之后远端有没有回绿——离线面判不了，取证通道是 `--remote`（report-only，见下），终态读数落在 docs/escape-hatch-remote.json（`--update-remote` 生成）；另 sha 在浅克隆里能否解出（CI fetch-depth=1）也不判。')
  const heads = bypassHeads(lines)
  // C9 每次默认跑都判（只读一份 JSON，不联网），否则"有通道"会继续被读成"查过了"。
  const docPath = join(ROOT, REMOTE_DOC)
  let remoteDoc = null
  let docErr = ''
  if (existsSync(docPath)) {
    try { remoteDoc = JSON.parse(readFileSync(docPath, 'utf8')) } catch (e) { docErr = `${e.name}: ${e.message}` }
  } else docErr = '文件不在'
  const rec9 = reconcileRemote({ heads, doc: remoteDoc })
  const c9Prefix = rec9.state === 'COVERED' ? 'PASS' : (rec9.state === 'UNVERIFIED' ? 'UNVERIFIED' : 'FAIL')
  console.log(`${c9Prefix}  C9 :: 绕过终态读数对账 :: ${docErr ? `读数读不动（${docErr}）⇒ ` : ''}${rec9.detail}`)
  for (const h of rec9.rows.slice(0, 6)) console.log(`      未在册终态：${String(h).slice(0, 10)}`)
  // C10 判的是**结论**：读数盖住了账（COVERED）不等于判决面红的那些被处置过。
  // 默认每次都印（纯读同一份 JSON、不联网），`--require-disposition` 才升 rc。
  const rec10 = reconcileDisposition({ rows: (remoteDoc && remoteDoc.rows) || [] })
  const c10Prefix = rec10.state === 'OPEN' ? 'FAIL' : 'PASS'
  console.log(`${c10Prefix}  C10 :: 绕过终态结论闭环 :: 判决面=${scopeWorkflow()}｜${rec10.detail}`)
  for (const x of rec10.rows.slice(0, 6)) console.log(`      ${x.why}`)
  if (argv.includes('--update-remote')) {
    if (!heads.length) { console.log('[report:escape-hatch-remote] 账本里没有绕过记录 ⇒ 不写读数（写一份空册就是把"没有对象"固化成证据）'); return r.rc }
    const rows = remoteRows(heads, ghRuns, { workflow: scopeWorkflow() })
    // 已存在的处置结论按 head 继承（`--update-remote` 是刷新读数，不是重审处置；抹掉处置
    // 就等于让"有人写过结论"变成"没人写过"，那样 C10 每次重生都必红，久了就没人看）。
    const prior = new Map(((remoteDoc && remoteDoc.rows) || []).map((x) => [String(x.head || '').toLowerCase(), x.disposition]))
    for (const row of rows) {
      const d = prior.get(String(row.head || '').toLowerCase())
      if (d) row.disposition = d
    }
    const payload = {
      schema: 'chaoshi-escape-hatch-remote-v1',
      note: '`node scripts/check-escape-hatch-log.mjs --update-remote` 生成；联网取数（gh api），**永不进阻断链**（网络不通时它会把一次正常提交判红而本地无可自愈处置，户内规⑩）。判决面 = `.ci/contract.json` 的 `workflow` 字段（当前 CI）；别的 workflow 的红只作旁证印出、不进判决（C9 判覆盖：账本有而读数无 = 未覆盖，读数有而账本无 = 死读数；C10 判结论：判决面 RED 且无 `disposition.why` = 待处置）。',
      generatedUtc: new Date().toISOString(),
      scopeWorkflow: scopeWorkflow(),
      repository: (spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 }).stdout || '').trim(),
      rows,
    }
    writeFileSync(docPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    const by = {}
    for (const x of rows) by[x.state] = (by[x.state] || 0) + 1
    console.log(`[report:escape-hatch-remote] 读数已写 ${REMOTE_DOC}｜判决面=${payload.scopeWorkflow}｜${rows.length} 条 :: ${Object.entries(by).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    return r.rc
  }
  if (argv.includes('--require-covered') && rec9.state !== 'COVERED') {
    console.log(`[verify:escape-hatch] C9 升档：--require-covered 要求账本每条绕过都有终态读数（实得 ${rec9.state}，未覆盖 ${rec9.uncovered}）⇒ rc=2 未验证；修法＝跑 \`node scripts/check-escape-hatch-log.mjs --update-remote\`，**不是**把这个开关关掉`)
    return 2
  }
  if (argv.includes('--require-disposition') && rec10.state === 'OPEN') {
    console.error(`[verify:escape-hatch] C10 升档：--require-disposition 要求判决面红过的绕过都有可证伪处置结论（实得待处置 ${rec10.open} 条）⇒ rc=1；`
      + `修法＝在 docs/escape-hatch-remote.json 对应行补 \`disposition.why\`（要含实测数字或可复跑命令，长度 ≥ ${MIN_DISPOSITION_CHARS}），`
      + `**不是**把 --require-disposition 关掉，也不是把 \`state\` 手改成 GREEN`)
    for (const x of rec10.rows.slice(0, 10)) console.error(`      ${x.why}`)
    return 1
  }
  if (argv.includes('--remote')) {
    console.log(`[report:escape-hatch-remote] report-only（**不改 rc，也不进阻断链**）：账本里 ${heads.length} 条绕过记录待对账｜判决面=${scopeWorkflow()}`)
    for (const row of remoteRows(heads, ghRuns, { workflow: scopeWorkflow() })) console.log(`  ${row.state}  ${row.id} :: ${row.detail}`)
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
