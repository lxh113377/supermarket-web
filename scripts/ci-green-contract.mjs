// @probe-safe: 骨架里实测 rc=1 / 0s（读不到 .ci/contract.json 即 fail-closed），gh 调用在其后才发生
// CI 全绿契约：把「CI 绿」从口头自觉变成推不动东西的硬闸。
//
// 立这条的实证代价（第二十一轮查到，不是假想风险）：`tests/d1RoundTrips.test.js` 缺
// `@vitest-environment node` 让 CI 从第十四轮起**连红 7 个 commit**，`deploy` job 被 needs
// 掐成 skipped，而期间三份对标报告都写着"CI 全绿 / 本地 82 files 全绿"。本地绿与 CI 绿
// 可以同时不成立（Node 小版本、`npm test` vs `vitest run --coverage` 是不同调用形态），
// 所以唯一凭据必须是**远端回执**。
//
// 四态：GREEN 放行 / RED 拒 / BLOCKED（有 run 但缺必需 job）拒 / UNKNOWN（取不到 run、
// gh 不可用、网络失败）拒 —— **裸静音判红**，绝不把"没查到"读成"没问题"。
// 逃生门：CI_GREEN_SKIP=1 才可绕过，且必须同时给 CI_GREEN_REASON，输出面 loudly 留痕。
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
export const CONTRACT_FILE = '.ci/contract.json'
export const WORKFLOW_PATH = '.github/workflows/ci.yml'

// ── 逃生门计量（第五十三轮 E3 / 内层 R53-H5）────────────────────────────────
// 一手：下面 `main()` 里那句「这笔账会留在 CI 与台账里」在写它的那天起就是**假主张**——同文件
// `grep -nE "writeFileSync|appendFile|ledger|\\.jsonl"` 实测 0 命中，而 pre-push 的 stderr 不进任何
// 被归档的 run 日志 ⇒ 绕过理由只活在那一刻。对照参照（当次读原文）：`pre-commit/pre-commit` 的
// `SKIP`（`pre_commit/commands/run.py:130`）同样不落盘，但它在运行输出里逐钩打 `Skipped`——
// 成熟做法至少"当场可见"；本仓必须多走一步：**把绕过写进版本库**，因为没人看得见那次 stderr。
// 时机要说清：pre-push 跑在 push **之前**，所以这条记录进的是**下一笔提交**，不是被绕开的那一笔
// （常驻判据 `verify:escape-hatch` 每次都核全部历史行，所以不会漏读）。
export const ESCAPE_LEDGER = '.ci/escape-hatch.jsonl'
export const ESCAPE_REQUIRED = ['utc', 'base_sha', 'head_sha', 'branch', 'reason', 'actor']

/** 组一条记录：任何必填项为空就抛（fail-closed）——不许写出一条"看着记了、其实没法复算"的行。 */
export function buildEscapeRecord(input = {}) {
  const rec = {
    utc: String(input.utc || new Date().toISOString()),
    base_sha: String(input.base || '').trim(),
    head_sha: String(input.head || '').trim(),
    branch: String(input.branch || '').trim(),
    reason: String(input.reason || '').trim(),
    actor: String(input.actor || '').trim(),
  }
  if (input.backfilled) rec.backfilled = true
  // kind/backfilled/note 必须透传：`genesis` 起始行不是绕过记录，丢了 kind 就会把它计成一次绕过
  // （第五十三轮实测：写入器只认自己列的六个字段，刚落盘的 genesis 在账面上成了"绕过 2 / 起始 0"）。
  if (input.kind) rec.kind = String(input.kind)
  if (input.note) rec.note = String(input.note)
  const miss = ESCAPE_REQUIRED.filter((k) => !rec[k])
  if (miss.length) {
    throw new Error(`记录缺必填项：${miss.join(', ')}（base/head 取不到时禁止留空放行——那等于记了一笔对不了账的账）`)
  }
  if (rec.reason.length < 20) throw new Error(`理由只有 ${rec.reason.length} 字，短于 20 ⇒ 不足以复算当时为什么必须绕`)
  if (!/^[0-9a-f]{7,40}$/.test(rec.base_sha) || !/^[0-9a-f]{7,40}$/.test(rec.head_sha)) {
    throw new Error('base_sha/head_sha 必须是 7–40 位十六进制')
  }
  return rec
}

/** 追加一行（append-only；显式锁 `\n`、UTF-8 —— 户内规「记指纹的写入必须锁 newline」同规）。 */
export function appendEscapeLedger(input = {}, dir = root) {
  const rec = buildEscapeRecord(input)
  const pth = join(dir, ESCAPE_LEDGER)
  mkdirSync(dirname(pth), { recursive: true })
  const line = JSON.stringify(rec) + '\n'
  appendFileSync(pth, line, 'utf8')
  return { path: pth, bytes: Buffer.byteLength(line), rec }
}

/**
 * 落点可覆盖（`CI_GREEN_LEDGER_DIR`）——不覆盖就会让夹具往真账本里写记录：未变异的那条 CLI 腿
 * 以 `cwd=REPO` 跑生产脚本，绕过分支会往仓内 `.ci/escape-hatch.jsonl` 追加一行，
 * 于是"演练"污染了本该只记真实绕过的审计面（本轮实测确实多写过一行，已删）。
 * 测试一律把落点指到临时目录；真账本只由真绕过写入。
 */
function ledgerDir() {
  const d = (process.env.CI_GREEN_LEDGER_DIR || '').trim()
  return d ? resolve(d) : root
}

/** 绕过者署名：git 配置的 user.name，取不到退回环境变量；都没有就写 unknown。**绝不**读任何密钥面。 */
function actorOf() {
  try {
    const n = execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' })
    if (n && n.trim()) return n.trim()
  } catch { /* 取不到就走环境变量 */ }
  return String(process.env.USERNAME || process.env.USER || 'unknown')
}

/**
 * 手工执行（没有 pre-push 的 ref 行、也没有 CI_GREEN_BASE）时 base 的真实回退链：取远端跟踪引用。
 * 第五十三轮实发：既有夹具 `tests/ciGreenContract.test.js` 的「带理由就放行」腿走的正是这条路径，
 * base 取不到时被新加的 fail-closed 拒成 rc=1。**放宽校验是错的**（那等于允许记一条对不了账的账），
 * 正解是把 base 接到真实可得的地方；真取不到（裸仓／无远端）才继续拒。
 */
function remoteBaseOf(contract) {
  const br = contract && contract.branch ? String(contract.branch) : 'HEAD'
  for (const ref of [`refs/remotes/origin/${br}`, 'refs/remotes/origin/HEAD']) {
    try {
      const sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: root, encoding: 'utf8' }).trim()
      if (/^[0-9a-f]{7,40}$/.test(sha)) return sha
    } catch { /* 这条引用不存在就试下一条；全失败交给调用方拒放行 */ }
  }
  return ''
}

export function loadContract(dir = root) {
  const p = join(dir, CONTRACT_FILE)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return 'PARSE_ERROR' }
}

/**
 * ── 恢复性提交的承认通道（第七十三轮，治护栏的自锁）。
 *
 * 一手动因（本轮实测，6 次 push 同一结论）：本契约只认**远端基线**的回执，而基线 `183ba0c` 的
 * run `37747723889` 是 `cancelled` ⇒ "修好那次 cancelled 的那笔提交"被"那次 cancelled"永久挡在门外。
 * 第 72 轮 §3 已经写下过同一形态（"本轮接手时 HEAD 与远端同 sha 且该 sha 的 CI 是红的 ⇒ pre-push
 * 会把下一次推送一并锁死"），当时靠逃生门过去；两轮之后它又发生 ⇒ **这不是偶发，是契约缺一条通道**。
 *
 * 为什么不放开逃生门就完事：`CI_GREEN_SKIP` 是"人宣布一次 + 落台账"，判据无法核验宣称与事实是否相符；
 * 本通道的四条前提全部机器可查，且**只在护栏因"缺判决"而拦的时候**成立：
 *   ① 基线终态 ∈ cancelled/timed_out/neutral/action_required —— CI **从没对这次改动下过判决**，
 *      护栏此刻拦的是"证据缺席"，不是"证据说红"。**真判据红（failure）一律不承认**，
 *      那种情况要么先把 CI 修绿、要么走逃生门并留下 C9/C10 读得到的处置。
 *   ② 提交说明必须带 `ci-green-recover: <runId>`，且该 runId **就是被拦的那一次**（点名才有历史可查，
 *      写错号就是张冠李戴，直接拒）。
 *   ③ 被推的那段 diff 必须真的改到出事的那个 workflow 文件 —— 声称修它却不碰它，就是空口。
 *   ④ 自限：近 20 笔里用这条通道超过 2 次 ⇒ 拒。CI 连续没判决说明流水线本身坏了，
 *      正确动作是停下来修流水线，不是继续往里推。**放行次数是判据，不是 discretion。**
 */
export const NO_VERDICT_CONCLUSIONS = ['cancelled', 'timed_out', 'neutral', 'action_required']
export const RECOVER_MARKER_RE = /ci-green-recover:\s*(\d{8,})/
export const RECOVER_WINDOW = 20
export const RECOVER_MAX = 2

export function recoveryAdmission ({ best, pending, markerCount = 0, workflowFile = '.github/workflows/ci.yml' }) {
  if (!best) return { ok: false, why: ['没有基线 run 可对照 ⇒ 无从承认恢复'] }
  if (!pending) return { ok: false, why: ['调用方没给要推的那笔（files/message）⇒ 不承认恢复，宁严勿宽'] }
  const concl = String(best.conclusion || '')
  if (!NO_VERDICT_CONCLUSIONS.includes(concl)) {
    return { ok: false, why: [`基线终态是 ${concl || '未知'} —— 那是 CI **下过判决**的红，本通道不认；要么先把 CI 修绿，要么走逃生门并在台账写处置`] }
  }
  const m = RECOVER_MARKER_RE.exec(String(pending.message || ''))
  if (!m) return { ok: false, why: [`提交说明里没有 \`${RECOVER_MARKER_RE.source.replace(/\\/g, '')}\` 标记 ⇒ 这笔没打算把"修的是哪一次事故"写进 git 历史`] }
  if (Number(m[1]) !== Number(best.databaseId)) {
    return { ok: false, why: [`标记点名的 run ${m[1]} 不是被拦的那次 ${best.databaseId} ⇒ 张冠李戴，拒`] }
  }
  const files = Array.isArray(pending.files) ? pending.files : []
  if (!files.includes(workflowFile)) {
    return { ok: false, why: [`被推的 diff 没改 ${workflowFile} ⇒ 声称修这次事故，却没动出事的那个 workflow`] }
  }
  if (markerCount > RECOVER_MAX) {
    return { ok: false, why: [`近 ${RECOVER_WINDOW} 笔里有 ${markerCount} 笔在用恢复通道 ⇒ CI 已连续没判决，该停下来修流水线，不是继续往里推`] }
  }
  return { ok: true, why: [`承认恢复：基线 run ${best.databaseId} 终态 ${concl}（CI 没下过判决）+ 标记点名同一次事故 + diff 改了 ${workflowFile}（近 ${RECOVER_WINDOW} 笔第 ${markerCount} 次用通道，上限 ${RECOVER_MAX}）`] }
}

/** 纯判据：喂远端回执，出四态。可被夹具喂合成输入（判据拆纯函数的既有口径）。
 *
 *  `availableJobs`（第七十三轮新增）= **被评的那个提交自己的** ci.yml 里真实存在的 job 名集合。
 *  一手：I-73-1 往 ci.yml 加了 `browser-install` 并把 `.ci/contract.json` 的 requiredJobs 同笔变成六个，
 *  而 pre-push 评的是**远端已有基线**（`183ba0c`）那一次 run —— 它的 job 名单里当然没有新 job，
 *  于是 `missing=[browser-install]` ⇒ BLOCKED ⇒ 下一次推送被"我还没推上去的东西"挡死。
 *  这与 `.ci/contract.json` 里 requiredJobAliases 记过的改名旧雷**是同一颗**：拿今天的名单判昨天的 run。
 *  正解不是再手抄一张"哪些 job 属于哪个时刻"的册子，而是**让分母由被评提交自己交出**（读该 commit 的 yml）。
 *  取不到（对象不在本地 / 文件不在该 commit）⇒ 传 null ⇒ 回落现行名单，**宁严勿宽**。 */
export function verdictOf({ sha, runs, contract, availableJobs = null, pending = null, workflowFile = '.github/workflows/ci.yml', markerCount = 0 }) {
  const declared = contract?.requiredJobs || []
  let need = declared
  if (contract && contract !== 'PARSE_ERROR' && availableJobs) {
    const face = availableJobs instanceof Set ? availableJobs : new Set(availableJobs)
    need = declared.filter((j) => face.has(j))
  }
  if (!contract) return { state: 'UNKNOWN', reason: `缺 ${CONTRACT_FILE} 或 JSON 不可解析 ⇒ 无法判定，按红处理` }
  if (contract === 'PARSE_ERROR') return { state: 'UNKNOWN', reason: `${CONTRACT_FILE} JSON 解析失败` }
  const mine = (runs || []).filter((r) => r.headSha === sha)
  if (!mine.length) return { state: 'UNKNOWN', reason: `远端查不到 sha=${sha} 的 ${contract.workflow} run ⇒ 可能是首次推送或 gh 鉴权/网络失效，不读成通过` }
  const best = mine.sort((a, b) => (b.databaseId || 0) - (a.databaseId || 0))[0]
  // run id 一律带上它属于哪个 sha：本契约量的是**基线**，新推的 commit 天生还没有 run。
  // 第三十六轮实测教训：推送时打印 `run 36314824897 全绿` 而没写 sha，我把**上一轮基线**的
  // 回执读成了"我这笔已绿"，而 81cd520 自己的 run 36318373975 其实在红 —— 回执不指名对象就等于没回执。
  const who = `run ${best.databaseId}@${String(sha).slice(0, 7)}`
  if (best.status !== 'completed') return { state: 'BLOCKED', reason: `${who} 仍在跑（status=${best.status}）⇒ 无结论，不放行` }
  const jobs = best.jobs || []
  const have = new Set(jobs.map((j) => j.name))
  // 交集为空 = 那个提交根本没有名单里的任何 job ⇒ 这不是"没有要求"，是取数面错位
  // （名单与 yml 不同笔、或 workflow 被整体改名）。零分母不折算成放行。
  if (!need.length && declared.length) {
    return { state: 'BLOCKED', reason: `${who} 的必需名单按该 commit 的 ci.yml 收窄后为空（在册 ${declared.length} ⇒ 现存 0）⇒ 名单与 workflow 已脱节，不读成"没有要求"` }
  }
  const missing = need.filter((j) => !have.has(j))
  if (missing.length) return { state: 'BLOCKED', reason: `${who} 缺少必需 job: ${missing.join(', ')}（needs 断了就是没发出去）` }
  const red = jobs.filter((j) => need.includes(j.name) && j.conclusion !== 'success').map((j) => `${j.name}=${j.conclusion}`)
  if (best.conclusion !== 'success' || red.length) {
    const why0 = `${who} conclusion=${best.conclusion}${red.length ? '；失败 job: ' + red.join(', ') : ''}`
    const ad = recoveryAdmission({ best, pending, workflowFile, markerCount })
    if (ad.ok) return { state: 'RECOVER', reason: `${why0} ⇒ 恢复性提交被承认：${ad.why.join('；')}` }
    return { state: 'RED', reason: why0 + (pending ? `｜恢复通道不成立：${ad.why.join('；')}` : '') }
  }
  return { state: 'GREEN', reason: `${who} 全绿，必需 job 齐备：${need.join(', ')}` }
}

/** 从一段 workflow 正文里取 job 名（`jobs:` 下两空格缩进的键）。纯函数，便于夹具喂文本。 */
export function jobNamesOf(workflowText) {
  const start = String(workflowText || '').indexOf('\njobs:\n')
  if (start < 0) return []
  const out = []
  for (const line of workflowText.slice(start + 7).split(/\r?\n/)) {
    const m = /^  ([a-zA-Z0-9_-]+):[ \t]*(?:#.*)?$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

/** 把"要推的那一段"摊成承认通道要的形态：改动文件清单 + 末端提交说明。取不到返回 null。 */
export function recoveryFaceOf (baseSha, localSha, dir = root) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(baseSha || '')) || !/^[0-9a-f]{7,40}$/i.test(String(localSha || ''))) return null
  if (/^0+$/.test(String(localSha || ''))) return null
  try {
    const files = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', `${baseSha}..${localSha}`],
      { cwd: dir, encoding: 'utf8', timeout: 20_000 }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    const message = execFileSync('git', ['log', '-1', '--format=%B', localSha], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
    if (!files.length || !message) return null
    return { files, message: String(message) }
  } catch { return null }
}

/** 近 window 笔里有多少笔用过恢复通道（放行次数是判据，不是 discretion）。 */
export function recoveryUseCount (localSha, dir = root, window = RECOVER_WINDOW) {
  try {
    const log = execFileSync('git', ['log', `-${window}`, '--format=%B', localSha], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
    return String(log).split(RECOVER_MARKER_RE).slice(1).filter((x) => /^\d{8,}/.test(x.trim())).length
  } catch { return window }
}

/** 取某个提交自己的 ci.yml job 名单；任何一步不成都返回 null（调用方回落现行名单 ⇒ 宁严勿宽）。
 *  ref 形态不做"必须是十六进制"的假设：本函数要被 `HEAD`、被 tag 名、被短 sha 调，
 *  而 `HEAD` 里的 `H` 就不是十六进制字符 —— 第一版按 sha 正值守卫，直接把这条通道写成永不生效
 *  （新加的夹具腿当场把它抓到，见 tests/ciGreenContract.test.js「生产面」那条）。
 *  真正的不存在/取不到由 git 自己的非 0 退出兜住，比自造词法检查可靠。 */
export function ciJobNamesAt(sha, dir = root) {
  const ref = String(sha || '')
  if (!ref || ref.length > 80 || /\s|\.\.|\^|:/.test(ref)) return null
  try {
    const text = execFileSync('git', ['-c', 'core.quotepath=false', 'show', `${ref}:${WORKFLOW_PATH}`], {
      cwd: dir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20_000,
    })
    const names = jobNamesOf(text)
    return names.length ? new Set(names) : null
  } catch { return null }
}

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(out || '[]')
}

/**
 * pre-push 的 ref 行：`<local_ref> <local_sha> <remote_ref> <remote_sha>`（git 官方格式，可能多行）。
 * 单独成纯函数是必须的：上一版用 `^(?:refs\/(?:heads|tags)\/)?(.+)$` 取分支名，
 * `(.+)` 贪婪吃掉**整行**（含两个 SHA），于是分支名是个带空格的怪物 ⇒ ls-remote 必然取不到 ⇒
 * 每次推送都判红。而这一层从来没有夹具跑过（单测 import 的只有 verdictOf），所以两个缺陷互相掩盖：
 * 修掉 stdin 的 ReferenceError 之后，闸门会从"永远读不到 ref 行"变成"永远判红"。
 */
export function parseRefLines(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 4 || !f[0]) continue
    out.push({ localRef: f[0], localSha: f[1], remoteRef: f[2], remoteSha: f[3] })
  }
  return out
}

const SHA40 = /^[0-9a-f]{40}$/
const ZEROS = /^0+$/
const branchOf = (ref) => String(ref || '').replace(/^refs\/(?:heads|tags)\//, '')

/** 取某个基点 SHA 的 workflow run + job 明细；取不到一律返回 {error}，由调用方判红。 */
function fetchRun(contract, sha) {
  let listed
  try {
    listed = ghJson(['run', 'list', '--workflow', contract.workflow, '--limit', '15',
      '--json', 'databaseId,headSha,conclusion,status,name'])
  } catch (e) {
    return { error: `gh 不可用/未鉴权/网络失败：${String(e.message).split('\n')[0]}` }
  }
  const hit = (listed || []).filter((r) => r.headSha === sha).sort((a, b) => (b.databaseId || 0) - (a.databaseId || 0))[0]
  if (!hit) return { error: `远端查不到 sha=${sha.slice(0, 7)} 的 ${contract.workflow} run` }
  try {
    return { run: { ...hit, jobs: ghJson(['run', 'view', String(hit.databaseId), '--json', 'jobs']).jobs || [] } }
  } catch (e) {
    // 拿不到 job 明细 ⇒ 交给 verdictOf 的 BLOCKED（缺必需 job 就是不放行）；
    // 但根因要留在打印行里，否则"缺 job"会被误读成"CI 真少了一个 job"。
    return { run: { ...hit, jobs: [] }, jobsError: String(e.message).split('\n')[0] }
  }
}

export function main({ pushRef = null, remoteSha = null } = {}) {
  const contract = loadContract()
  if (!contract || contract === 'PARSE_ERROR') {
    console.error(`[ci-green] FAIL-CLOSED 读不到合法的 ${CONTRACT_FILE}`)
    return 1
  }
  const skip = process.env[contract.escapeHatch || 'CI_GREEN_SKIP']
  if (skip) {
    const reason = (process.env.CI_GREEN_REASON || '').trim()
    if (!reason) { console.error(`[ci-green] ${contract.escapeHatch} 已设但 CI_GREEN_REASON 为空 ⇒ 仍拒（逃生门要留可审计的理由）`); return 1 }
    // 落账排在放行**之前**：写不进去就拒放行。没有计量的逃生门，等于给护栏装了个不带日志的开关。
    const r0 = (parseRefLines(pushRef || ''))[0] || {}
    let head = String(r0.localSha || remoteSha || '').trim()
    if (!head) {
      try { head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() } catch { head = '' }
    }
    const base = String(r0.remoteSha || process.env.CI_GREEN_BASE || remoteBaseOf(contract) || '').trim()
    const branch = String(r0.localRef || `refs/heads/${contract.branch}`).replace(/^refs\/heads\//, '')
    let w = null
    try {
      w = appendEscapeLedger({ base, head, branch, reason, actor: actorOf() }, ledgerDir())
    } catch (e) {
      console.error(`[ci-green] FAIL 逃生门无法落账（${e.message}）⇒ 拒放行：这笔绕过一旦放行就无人能复算它发生过什么`)
      return 1
    }
    console.error(`[ci-green] !! 绕过契约 !! 已追加 1 行（${w.bytes}B）→ ${ESCAPE_LEDGER}`
      + `｜base=${w.rec.base_sha.slice(0, 7)}→head=${w.rec.head_sha.slice(0, 7)}｜branch=${w.rec.branch}｜actor=${w.rec.actor}`)
    // 只陈述已发生的事：记录此刻还在本机工作树里，**下一笔提交**才进版本库；
    // 而"远端有没有回绿"本判据不判（要联网，做成阻断项就成了不可自愈的闸）。
    console.error('[ci-green] !! 计量已落盘，但记录进的是下一笔提交；远端是否回绿**不在本判据面内**，请自行确保并回读 run。')
    return 0
  }
  // 无 ref 行（手工执行）时退回契约分支 + CI_GREEN_BASE，保持"人也能直接跑这一条"的用法
  const refs = parseRefLines(pushRef)
  if (!refs.length) refs.push({ localRef: null, localSha: null, remoteRef: `refs/heads/${contract.branch}`, remoteSha: remoteSha || null })

  let rc = 0
  const seen = new Map()
  for (const r of refs) {
    const branch = branchOf(r.remoteRef) || contract.branch
    const tag = `[ci-green] branch=${branch}`
    if (ZEROS.test(String(r.localSha || ''))) {
      console.log(`${tag} SKIP :: 删除分支（local_sha 全 0）⇒ 不往任何基座上叠加，无需回执`)
      continue
    }
    // 判据基点 = **远端当前 SHA**，不是本次 HEAD。新提交天生还没有 run，拿 HEAD 当判据
    // 会让任何首次推送都不可通过（第二十三轮接线时，这条闸真的把我自己的推送拦下过一次）。
    // 契约语义是"别在红基座上继续叠加"—— 第十四~二十一轮那 7 个 commit 正是红基座上叠出来的。
    let base = SHA40.test(String(r.remoteSha || '')) ? r.remoteSha : null
    if (base && ZEROS.test(base)) {
      console.log(`${tag} SKIP :: 新建分支（remote_sha 全 0）⇒ 远端还没有基线可保护`)
      continue
    }
    if (!base) {
      try {
        base = (execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' }).trim().split(/\s+/)[0] || null)
      } catch { base = null }
    }
    if (!base || !SHA40.test(base) || ZEROS.test(base)) {
      console.error(`${tag} FAIL-CLOSED base=- :: 取不到远端 ${branch} 当前 SHA ⇒ 基线无法判定，不放行`)
      rc = 1
      continue
    }
    if (!seen.has(base)) seen.set(base, fetchRun(contract, base))
    const got = seen.get(base)
    if (got.error) {
      console.error(`${tag} FAIL-CLOSED base=${base.slice(0, 7)} :: ${got.error} ⇒ 取不到远端回执不等于没事。` +
        `要么修 gh，要么显式 ${contract.escapeHatch}=1 CI_GREEN_REASON="..." 并自行担责。`)
      rc = 1
      continue
    }
    // 分母由**被评的那个提交**自己的 ci.yml 交出（见 verdictOf 的 availableJobs 注）：
    // 拿今天的名单判昨天的 run，就是在要求一份当时不可能存在的回执。
    const face = ciJobNamesAt(base)
    // 要推的那笔（base..local_sha）摊成 pending 喂给承认通道：改了哪些文件 + 提交说明里的 runId 标记。
    // 取不到 ⇒ pending=null ⇒ 通道不成立（宁严勿宽），而不是"看不见就放行"。
    const pending = recoveryFaceOf(base, r.localSha)
    const markerCount = recoveryUseCount(r.localSha)
    const v = verdictOf({ sha: base, runs: [got.run], contract, availableJobs: face, pending, markerCount })
    const line = `${tag} ${v.state} base=${base.slice(0, 7)} local=${(r.localSha || '-').slice(0, 7)} :: ${v.reason}` +
      (got.jobsError ? `（job 明细拉取失败：${got.jobsError}）` : '') +
      (face ? `｜分母取自该 commit 的 ci.yml（${[...face].length} 个 job）` : '｜该 commit 的 ci.yml 取不到 ⇒ 回落现行名单，不放宽')
    if (v.state === 'GREEN') { console.log(line); continue }
    if (v.state === 'RECOVER') {
      console.log(line.replace(` ${v.state} `, ' RECOVER '))
      console.log(`${tag} ⚠ 恢复通道放行 1 次（近 ${RECOVER_WINDOW} 笔第 ${markerCount} 次，上限 ${RECOVER_MAX}）`
        + `｜它只在基线"从未下过判决"时才成立，真判据红走不到这里`
        + `｜留痕 = 提交说明里的 ci-green-recover: <runId>，git 历史里查得到，不另立台账`)
      continue
    }
    console.error(line)
    rc = 1
  }
  return rc
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  // pre-push 的 ref 行走 **stdin**（local_ref local_sha remote_ref remote_sha），
  // argv 只有 remote 名与 URL —— 上一版从 argv 取 SHA 是取不到的。
  // 读取失败/为空**必须留痕**：这里曾因为写成 `fs.readFileSync`（模块里根本没有 `fs` 这个标识符，
  // ReferenceError 被空 catch 吞成 line=''）而让整条 stdin 通道静默失效，且单测碰不到这一段。
  let line = ''
  if (!process.stdin.isTTY) {
    try {
      line = readFileSync(0, 'utf8')
    } catch (e) {
      console.error(`[ci-green] !! stdin 读不到（${String(e.message).split('\n')[0]}）⇒ 退回契约分支 + ls-remote 基点，不再静默`)
      line = ''
    }
  }
  process.exit(main({ pushRef: line || null, remoteSha: process.env.CI_GREEN_BASE || null }))
}
