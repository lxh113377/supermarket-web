// @probe-safe: 骨架实测 rc=2 / 0.1s（缺 `docs/benchmark-peers.json` 时 `requireJson` 在**首次 gh 调用之前**即 bail，
// 网络面在其后才走）；另有 `--offline` 腿实测 rc=2 / 10 仓全部按不可得计（零触网、零落盘）
// 第五十九轮 H-59-2：对标取证载体 —— 一条命令重取对方侧全部事实。
//
// 为什么要有这个脚本（一手动因，本仓自己的记录）：第五十七轮与第五十八轮的报告里，对方侧数字全部写作
// 「转引」（原文：`未实时拉取 GitHub API，对方侧数字沿用第五十七轮实测……不按新事实使用`）。
// 转引不是取数，是把上一轮的话再抄一遍：两轮下来，「mall 社区大、日更」这句被抄了 2 遍，
// 而本轮实测它近 30 天默认分支只有 2 次提交、最后一次 release 在 2024-03。
// 换句话说：**没有载体时，"标为转引"这种诚实做法反而让错误结论活得更久**——
// 下一轮不带记忆的人只会看到一张表，看不出哪一列是量出来的。
// 本脚本就是那个载体：名册在册（docs/benchmark-peers.json），数字现取，取不到就明写取不到。
//
// 三条不折算的口径（判据的立点）：
// ① 任何一面取不到 ⇒ 该字段 `null` + 该 peer `status=UNAVAILABLE/PARTIAL`，**绝不写 0**（0 是测量值，不是"没测"）；
// ② 整体 rc=2 表示存在不可观测面 ⇒ 报告里只能写 UNVERIFIED，不得写"全绿/已核对"；
// ③ 我方与对方走同一函数、同一窗口、同一时区（UTC），否则「230 vs 2」这种对比不成立。
//
// 用法：node scripts/benchmark-peers.mjs                     人读表（逐 peer 一行 + 不可得面点名）
//       node scripts/benchmark-peers.mjs --json <path>       同时落 JSON 台账
//       node scripts/benchmark-peers.mjs --offline           不触网，只验名册形状（CI 无网时的降级腿）
//       node scripts/benchmark-peers.mjs --selftest          跑内置正反例（含"404 不得折成 0"这条反例）
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { requireJson } from './lib/preflight.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
export const ROSTER = 'docs/benchmark-peers.json'

/** 单条 API 调用的墙上时钟上限；超时按"这一面取不到"处理，不重试成"这一面是 0"。 */
const PER_CALL_MS = 20000

function gh(path, { headers = false } = {}) {
  const args = ['api', path]
  if (headers) args.push('--include')
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: PER_CALL_MS, windowsHide: true })
  if (r.error) return { err: `spawn-failed:${r.error.code || r.error.message}` }
  if (r.status !== 0) {
    const msg = (r.stderr || '').split(/\r?\n/)[0] || `rc=${r.status}`
    return { err: msg.slice(0, 160) }
  }
  const out = r.stdout || ''
  if (!headers) {
    try { return { json: JSON.parse(out) } } catch { return { err: 'unparsable-json' } }
  }
  const bodyAt = out.indexOf('\r\n\r') >= 0 ? out.indexOf('\r\n\r') : out.indexOf('\n\n')
  const head = bodyAt < 0 ? out : out.slice(0, bodyAt)
  const body = bodyAt < 0 ? '' : out.slice(bodyAt).replace(/^[\r\n]+/, '')
  const link = /^link:\s*(.*)$/im.exec(head)
  try { return { json: JSON.parse(body || 'null'), link: link ? link[1] : '' } }
  catch { return { err: 'unparsable-response' } }
}

/** 从 Link 头取 `rel="last"` 的页号 —— 每页 1 条时它等于总条数。 */
export function lastPageFromLink(link) {
  if (!link) return null
  // 必须锚在 `[?&]page=`：`per_page=1` 里也含 "page="，不锚会先命中它并恒返回 1（本轮 selftest 的正例就是这么抓到这个 bug 的）。
  const m = /[?&]page=(\d+)[^>]*>\s*;?\s*rel="last"/.exec(link)
  return m ? Number(m[1]) : null
}

/** 逐页取到不满一页为止（每页 100，上限 40 页 = 4000 条，够本项目所有对手段位）。 */
function countCommits(repo, sinceIso, call) {
  let total = 0
  for (let page = 1; page <= 40; page++) {
    const r = call(`repos/${repo}/commits?since=${sinceIso}&per_page=100&page=${page}`)
    if (r.err) return { err: page === 1 ? `commits(${r.err})` : `commits(p${page} ${r.err})`, n: null }
    if (!Array.isArray(r.json)) return { err: 'commits(非数组)', n: null }
    total += r.json.length
    if (r.json.length < 100) return { n: total }
  }
  return { n: total, err: 'commits=触 40 页上限(需扩页界)' }
}

/**
 * 取一个仓的六面事实。`call` 可注入（单测打桩用），生产走真 `gh api`。
 * 返回的每个数值字段要么是真测量值，要么是 null；null 一律进 `unavailable` 名单。
 */
export function measureOne(repo, { windowDays = 30, sinceIso = '', call = gh } = {}) {
  const rec = { repo, stars: null, openRefs: null, pushedAt: null, archived: null,
    commitsInWindow: null, contributors: null, latestRelease: null, unavailable: [] }

  const meta = call(`repos/${repo}`)
  if (meta.err) rec.unavailable.push(`repo-meta(${meta.err})`)
  else {
    const j = meta.json || {}
    if (typeof j.stargazers_count === 'number') rec.stars = j.stargazers_count
    else rec.unavailable.push('stars')
    // GitHub 的 open_issues_count 含 PR（本轮实测：本仓该值 4，逐条查全是 dependabot PR）
    // ⇒ 字段名如实改成 openRefs，不叫 issues，免得下一轮又把它读成"4 个没人理的缺陷"。
    if (typeof j.open_issues_count === 'number') rec.openRefs = j.open_issues_count
    else rec.unavailable.push('openRefs')
    if (j.pushed_at) rec.pushedAt = j.pushed_at
    else rec.unavailable.push('pushedAt')
    if (typeof j.archived === 'boolean') rec.archived = j.archived
    else rec.unavailable.push('archived')
  }

  const c = countCommits(repo, sinceIso, call)
  if (c.n !== null) rec.commitsInWindow = c.n
  if (c.err) rec.unavailable.push(c.err)

  const contrib = call(`repos/${repo}/contributors?per_page=1`, { headers: true })
  if (contrib.err) rec.unavailable.push(`contributors(${contrib.err})`)
  else {
    const n = lastPageFromLink(contrib.link)
    if (n === null) rec.unavailable.push('contributors(无 last 页头)')
    else rec.contributors = n // 口径：GitHub 非匿名贡献者列表页上限（大仓该 API 封顶 500）
  }

  const rel = call(`repos/${repo}/releases/latest`)
  if (rel.err) rec.unavailable.push(`release(${rel.err})`)
  else if (rel.json && rel.json.tag_name) rec.latestRelease = `${rel.json.tag_name}@${rel.json.published_at || '?'}`
  else rec.unavailable.push('release(无 tag_name)')

  rec.status = rec.unavailable.length === 0 ? 'OK'
    : (rec.stars === null && rec.commitsInWindow === null) ? 'UNAVAILABLE' : 'PARTIAL'
  rec.windowDays = windowDays
  return rec
}

/** 近 windowDays 天的 UTC 起点（对方与我方同一把尺）。 */
export function sinceIso(nowMs = Date.now(), windowDays = 30) {
  return new Date(nowMs - windowDays * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function renderRows(records, { self, since }) {
  const lines = []
  for (const r of records) {
    const cell = (k, v) => `${k}=${v === null || v === undefined || v === '' ? '—' : v}`
    lines.push([
      r.repo === self ? `${r.repo}（本项目）` : r.repo,
      cell('star', r.stars), cell('开refs', r.openRefs),
      cell(`近${r.windowDays}天提交`, r.commitsInWindow), cell('贡献者', r.contributors),
      cell('最后push', r.pushedAt ? r.pushedAt.slice(0, 10) : null),
      cell('release', r.latestRelease),
      r.status === 'OK' ? 'OK' : `${r.status}｜不可得面: ${r.unavailable.join('；')}`,
    ].join('  '))
  }
  lines.push('', `窗口 = 近 ${records[0]?.windowDays} 天（起点 ${since}，UTC）｜口径：开refs = open_issues_count（GitHub 该字段含 PR，本仓实测 4 条全为 dependabot PR）；贡献者 = GitHub 贡献者列表页上限（大仓该 API 封顶 500）；取不到的面一律「—」并点名，禁折算成 0。`)
  return lines.join('\n')
}

/** 反例：证明这条链在"取不到"时不会谎报数字（本轮最担心的正是这个）。 */
export function selftest() {
  const cases = []
  const add = (name, ok, detail) => cases.push({ name, ok, detail })

  const four04 = { err: 'Not Found' }
  const r1 = measureOne('x/y', { sinceIso: 's', call: () => four04 })
  add('反例：全面 404 ⇒ 数字一律 null、status=UNAVAILABLE、绝不出现 0',
    r1.stars === null && r1.commitsInWindow === null && r1.contributors === null
    && r1.status === 'UNAVAILABLE' && !JSON.stringify(r1).includes('"stars":0'),
    `status=${r1.status} unavailable=${r1.unavailable.length}`)

  const r2 = measureOne('x/y', {
    sinceIso: 's',
    call: (p) => (p.includes('contributors') ? { err: 'boom' }
      : p.includes('commits') ? { json: p.includes('page=2') ? [] : new Array(100).fill({ sha: 'a' }) }
        : p.includes('releases') ? { err: 'Not Found' }
          : { json: { stargazers_count: 5, open_issues_count: 2, pushed_at: '2026-10-01T00:00:00Z', archived: false } }),
  })
  add('反例：部分面红 ⇒ status=PARTIAL 且点名 contributors/release；提交数走分页合并成精确值而非停在 100',
    r2.status === 'PARTIAL' && r2.contributors === null && r2.commitsInWindow === 100
    && r2.unavailable.some((u) => u.startsWith('contributors'))
    && r2.unavailable.some((u) => u.startsWith('release'))
    && !r2.unavailable.some((u) => u.startsWith('commits')),
    `status=${r2.status} commits=${r2.commitsInWindow} unavailable=${r2.unavailable.join('；')}`)

  add('正例：Link 头 rel="last" 解析出总页数',
    lastPageFromLink('<https://api.github.com/x?per_page=1&page=2>; rel="next", <https://api.github.com/x?per_page=1&page=280>; rel="last"') === 280,
    '280')
  add('反例：无 last 头 ⇒ null（不猜 1 页）',
    lastPageFromLink('<https://api.github.com/x?per_page=1&page=2>; rel="next"') === null,
    String(lastPageFromLink('<https://api.github.com/x?per_page=1&page=2>; rel="next"')))
  add('反例：`per_page=1` 里也含 "page="，不锚 [?&] 会恒返回 1（本轮实测踩到的形态）',
    lastPageFromLink('<https://api.github.com/x?per_page=1&page=280>; rel="last"') !== 1
    && lastPageFromLink('<https://api.github.com/repositories/1/contributors?per_page=1&page=280>; rel="last"') === 280,
    String(lastPageFromLink('<https://api.github.com/x?per_page=1&page=280>; rel="last"')))
  add('反例：只有 next 却把页号当 last 用 ⇒ 判红形态已挡',
    lastPageFromLink('') === null && lastPageFromLink(null) === null, '空/缺头')

  const since = sinceIso(Date.UTC(2026, 9, 1, 12, 0, 0), 30)
  add('正例：窗口起点 = 当日 UTC 减 30 天（不带毫秒）',
    since === '2026-09-01T12:00:00Z', since)

  const bad = measureOne('x/y', { sinceIso: 's', call: () => ({ json: { stargazers_count: 'lots' } }) })
  add('反例：字段类型不对（"lots"）⇒ 记为不可得，不做 Number() 强转成 NaN/0',
    bad.stars === null && bad.unavailable.includes('stars'),
    `stars=${String(bad.stars)} unavailable=${bad.unavailable.join('；')}`)

  return cases
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    const cases = selftest()
    let bad = 0
    for (const c of cases) {
      if (!c.ok) bad++
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  mut :: ${c.name} :: ${c.detail}`)
    }
    console.log(`==== selftest: ${cases.length - bad}/${cases.length} 通过 ====`)
    console.log(bad ? '[GATE:peers-selftest-fail]' : '[GATE:peers-selftest-pass]')
    process.exit(bad ? 1 : 0)
  }

  requireJson('PEERS', [ROSTER])
  const roster = JSON.parse(readFileSync(join(root, ROSTER), 'utf8'))
  const targets = [{ repo: roster.self, kind: '本项目' }, ...roster.peers.map((p) => ({ repo: p.repo, kind: p.kind }))]
  const badNames = targets.map((t) => t.repo).filter((r) => !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(r))
  if (badNames.length) {
    console.log(`GATE-FAIL benchmark-peers :: 名册里有 ${badNames.length} 个非 owner/name 全名：${badNames.join('、')}（短名会同时造成解析失败与类别错判，禁入册）`)
    process.exit(1)
  }

  const since = sinceIso(Date.now(), roster.windowDays)
  const offline = argv.includes('--offline')
  const call = offline ? () => ({ err: 'offline-mode' }) : gh
  const records = targets.map((t) => measureOne(t.repo, { windowDays: roster.windowDays, sinceIso: since, call }))

  console.log(renderRows(records, { self: roster.self, since }))
  const blind = records.filter((r) => r.status !== 'OK')
  const jsonAt = argv.indexOf('--json')
  if (jsonAt >= 0 && argv[jsonAt + 1]) {
    writeFileSync(join(root, argv[jsonAt + 1]), JSON.stringify({
      measuredAt: new Date().toISOString(), windowDays: roster.windowDays, since: since,
      mode: offline ? 'offline' : 'live', self: roster.self,
      kinds: Object.fromEntries(targets.map((t) => [t.repo, t.kind])), records,
    }, null, 2) + '\n', 'utf8')
    console.log(`台账已落 ${argv[jsonAt + 1]}`)
  }
  console.log(`GATE-${blind.length ? 'UNVERIFIED' : 'PASS'} benchmark-peers :: 名册 ${records.length} 仓（含本项目）｜全面可得 ${records.length - blind.length}｜存在不可得面 ${blind.length}${blind.length ? `（${blind.map((r) => r.repo).join('、')}）` : ''}｜${offline ? 'offline 模式，全部按不可得计' : ''}`)
  process.exit(blind.length ? 2 : 0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error('[benchmark-peers] 崩溃:', e); process.exit(2) })
}
