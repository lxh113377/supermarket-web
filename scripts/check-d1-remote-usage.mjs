// 远端 D1 累计用量对账（第四十二轮，R42-H1）。
//
// 为什么本轮必须建它：第三把尺（行写入配额）过去只有**下界**——本机能量出"单次最重调用写 21 行"，
// 于是登记册写"约 4,761 次/日"就当容量用。累计日用量取不到 ⇒ `docs/d1-write-quota.json` 里
// `remote_usage` 恒为 `UNVERIFIED`，谁也不知道真实刻度在哪一端。本轮把它接成可重跑的载体。
//
// 两条独立通道（各出一行读数，禁折叠成一条）：
//   ① GraphQL Analytics `d1AnalyticsAdaptiveGroups` —— 唯一能按 **UTC 日界**取的口径（配额 00:00 UTC 重置）；
//   ② `wrangler d1 info <db> --json` —— 平台自己的 CLI，给的是**滚动 24h**（见下"同行"）。
// 两通道口径不同不是冗余：① 空集而 ② 非零 ⇒ 大概率是①的窗口/参数写错了（本轮一手实证：
// 本地 09-28 04:45 对应 **UTC 09-27 20:45**，按"今天=09-28"取窗取到的是未来窗 ⇒ 返回空集且零报错）。
// 这类"静默空集"正是 U5 那条反差的靶子，所以 U8 另外把窗口本身钉死。
//
// 同行取证（本机 `gh api .../contents/<path>` 现取 @2026-09-28T04:30Z，raw.githubusercontent 被 Connection reset）：
//   `cloudflare/workers-sdk packages/wrangler/src/d1/info.ts:101-120` —— 四个指标先初始化成 0，
//     只有 `graphqlResult` 在场才把 `rows_written_24h` 等键**写进 output**：取不到时**整键省略**，
//     既不报错也不印 0。⇒ 本件的对应形态是"状态 + 原因"而不是把缺失折算成 0（0 与"不知道"必须可分）。
//   `同文件 :56-57`+`:87-88` —— 窗口是 `yesterday..today` 的**滚动 24h**，键名烙着 `_24h`；
//     与 D1 免费档"按日 00:00 UTC 重置"（`cloudflare/cloudflare-docs src/content/partials/workers/d1-pricing.mdx:24`）
//     不是同一个窗 ⇒ 本件同时取 UTC 日窗，并把两者差值如实报出来。
//   `google/go-github github/rate_limit.go:14-25` —— `Limit/Remaining/Reset` 三元组绑在**同一快照**里、
//     注释显式钉 UTC；`github/github.go:1654-1660` —— 读数为零值时按"不知道"放过，**绝不推断成"还有额度"**。
// 配额权威值不在本文件写死：从 `scripts/lib/d1-quota.mjs` import（同一事实只许一处判，见下方 import）。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bail, requireInputs } from './lib/preflight.mjs'

const SELF = 'scripts/check-d1-remote-usage.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
export const OUT_FILE = join(root, 'docs', 'd1-remote-usage.json')
// 与 check-d1-roundtrips.mjs 同源（同一事实只许一处判）：配额常量从 `scripts/lib/d1-quota.mjs` 取。
import { DAILY_ROWS_WRITTEN_FREE, DAILY_ROWS_READ_FREE, WRITE_QUOTA_FILE, remoteUsageClaim } from './lib/d1-quota.mjs'
export const HISTORY_DAYS = 7
export const VERDICTS = ['SAFE', 'WARNING', 'OVER', 'UNREACHABLE']
export const WARNING_RATIO = 0.8

/** UTC 日界（不是本地日）：本地 09-28 04:45 ⇒ UTC 09-27。本轮一手踩空的那条。 */
export function utcDay(d) {
  return new Date(d).toISOString().slice(0, 10)
}

/** 返回 {today_geq, today_lt, hist_geq, hist_lt}，全部 ISO-Z，窗口跨度恒为整天。 */
export function windowsFor(nowIso, days = HISTORY_DAYS) {
  const day = utcDay(nowIso)
  const midnight = Date.parse(`${day}T00:00:00Z`)
  const nextDay = new Date(midnight + 86_400_000).toISOString().slice(0, 10)
  const histStart = new Date(midnight - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  return {
    today_geq: `${day}T00:00:00Z`,
    today_lt: `${nextDay}T00:00:00Z`,
    hist_geq: `${histStart}T00:00:00Z`,
    hist_lt: `${nextDay}T00:00:00Z`,
  }
}

/**
 * 令牌只从 wrangler 的 OAuth 配置文件读，**不回显、不落盘、不进 JSON**。
 * 路径口径取自 `chaoshi-web-deploy` skill §2（实测：凭据在 xdg.config 下，不在 ~/.cloudflare）。
 */
export function readToken() {
  // CI 侧走 secrets（deploy job 已在用同名变量）；本机走 wrangler 的 OAuth 配置文件。两条都不回显值。
  const fromEnv = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
  if (fromEnv) return { ok: true, token: fromEnv, via: 'env:CLOUDFLARE_API_TOKEN' }
  const base = process.env.XDG_CONFIG_HOME || join(process.env.APPDATA || '', 'xdg.config')
  const p = process.env.CF_WRANGLER_CONFIG || join(base, '.wrangler', 'config', 'default.toml')
  if (!existsSync(p)) return { ok: false, reason: `凭据文件不存在 ${p}` }
  let m
  try { m = /^\s*oauth_token\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(p, 'utf8')) } catch (e) { return { ok: false, reason: `凭据文件读不出 ${e.code || e.name}` } }
  return m && m[1] ? { ok: true, token: m[1].trim() } : { ok: false, reason: `凭据文件里没有 oauth_token 行（${p}）` }
}

/** 账户 ID：env 优先（CI 里 ci.yml:331 注入），本机退回 `wrangler whoami --json`。取不到 ⇒ 不猜。 */
export function resolveAccount() {
  const fromEnv = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  if (fromEnv) return { ok: true, accountId: fromEnv, via: 'env' }
  const bin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!existsSync(bin)) return { ok: false, reason: '既无 CLOUDFLARE_ACCOUNT_ID，也没有本地 wrangler（先 npm ci）' }
  // skill §2 坑 2：bin shim 在 Git Bash 下坏，一律 node 直跑
  const r = spawnSync(process.execPath, [bin, 'whoami', '--json'], { cwd: root, encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) return { ok: false, reason: `wrangler whoami rc=${r.status}` }
  try {
    const j = JSON.parse(r.stdout)
    const acc = j?.accounts?.[0]?.id || j?.result?.accounts?.[0]?.id
    return acc ? { ok: true, accountId: acc, via: 'wrangler whoami' } : { ok: false, reason: 'wrangler whoami 没返回 accounts[0].id' }
  } catch { return { ok: false, reason: 'wrangler whoami 输出不是合法 JSON' } }
}

function gqlQuery(accountId, w) {
  return {
    query: `{viewer{accounts(filter:{accountTag:${JSON.stringify(accountId)}}){`
      + `today:d1AnalyticsAdaptiveGroups(limit:50,filter:{datetime_geq:${JSON.stringify(w.today_geq)},datetime_lt:${JSON.stringify(w.today_lt)}}){`
      + `sum{rowsRead rowsWritten readQueries writeQueries}dimensions{date databaseId}}`
      + `history:d1AnalyticsAdaptiveGroups(limit:200,filter:{datetime_geq:${JSON.stringify(w.hist_geq)},datetime_lt:${JSON.stringify(w.hist_lt)}}){`
      + `sum{rowsRead rowsWritten}dimensions{date databaseId}}}}}`,
  }
}

export async function fetchGraphql(token, accountId, w) {
  const retrievedAt = new Date().toISOString()
  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gqlQuery(accountId, w)),
      signal: AbortSignal.timeout(45_000),
    })
    const text = await res.text()
    if (!res.ok) return { state: 'UNREACHABLE', retrievedAt, reason: `HTTP=${res.status} ${(JSON.parse(text)?.errors?.[0]?.message || text).slice(0, 140)}` }
    const j = JSON.parse(text)
    if (j.errors && j.errors.length) {
      const e0 = j.errors[0]
      return { state: 'UNREACHABLE', retrievedAt, reason: `${e0.extensions?.code || 'graphql-error'} ${String(e0.message).slice(0, 140)}` }
    }
    const acc = j.data?.viewer?.accounts?.[0]
    if (!acc) return { state: 'UNREACHABLE', retrievedAt, reason: '响应里没有 viewer.accounts[0]（accountTag 过滤后为空）' }
    return { state: 'VERIFIED', retrievedAt, today: acc.today || [], history: acc.history || [] }
  } catch (e) {
    return { state: 'UNREACHABLE', retrievedAt, reason: `${e.name || 'fetch-error'} ${String(e.message).slice(0, 120)}` }
  }
}

/** 通道②：`wrangler d1 info` 的滚动 24h 读数（库名从 wrangler.toml 现取，不抄第二份）。 */
export function fetchWrangler(dbName) {
  const retrievedAt = new Date().toISOString()
  const bin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!existsSync(bin)) return { state: 'UNREACHABLE', retrievedAt, reason: '没有本地 wrangler（先 npm ci）' }
  const r = spawnSync(process.execPath, [bin, 'd1', 'info', dbName, '--json'], { cwd: root, encoding: 'utf8', timeout: 120_000 })
  if (r.status !== 0) return { state: 'UNREACHABLE', retrievedAt, reason: `wrangler d1 info rc=${r.status} ${(r.stderr || '').split(/\r?\n/).find((l) => l.trim().startsWith('X [ERROR]')) || ''}`.slice(0, 180) }
  try {
    const j = JSON.parse(r.stdout)
    const rolling = { rows_read_24h: j.rows_read_24h, rows_written_24h: j.rows_written_24h, read_queries_24h: j.read_queries_24h, write_queries_24h: j.write_queries_24h }
    if (rolling.rows_read_24h === undefined || rolling.rows_written_24h === undefined) {
      // info.ts:101-120 的形态：取不到就整键省略 ⇒ 这里必须如实记"没这个键"，不得补 0
      return { state: 'UNREACHABLE', retrievedAt, reason: `wrangler 输出缺 rows_*_24h 键（已省略=它也没取到）：${Object.keys(j).join(',')}` }
    }
    return { state: 'VERIFIED', retrievedAt, rolling, databaseId: j.uuid, databaseName: j.name }
  } catch (e) { return { state: 'UNREACHABLE', retrievedAt, reason: `输出不是 JSON（${e.name}）` } }
}

export function readDatabaseName() {
  const p = join(root, 'wrangler.toml')
  if (!existsSync(p)) return null
  const m = /^\s*database_name\s*=\s*"([^"]+)"/m.exec(readFileSync(p, 'utf8'))
  return m ? m[1] : null
}

const sumOf = (rows, key) => (rows || []).reduce((a, r) => a + (r.sum?.[key] || 0), 0)

export function byDate(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const d = r.dimensions?.date
    if (!d) continue
    const cur = m.get(d) || { rowsRead: 0, rowsWritten: 0 }
    cur.rowsRead += r.sum?.rowsRead || 0
    cur.rowsWritten += r.sum?.rowsWritten || 0
    m.set(d, cur)
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/**
 * 纯判据。三种出口：PASS / FAIL / SKIP（SKIP 只用于"这一腿需要远端读数而读数没到"），
 * 绝不把 SKIP 折算成 PASS。UNREACHABLE 是独立状态（VERDICTS 里单列），不并进 SAFE。
 */
export function evaluate({ graphql, wrangler, local, windows, nowIso }) {
  const out = []
  const push = (id, ok, label, detail) => out.push({ id, ok, label, detail })
  const skip = (id, label, detail) => out.push({ id, ok: null, label, detail })

  const gState = graphql?.state || 'UNREACHABLE'
  const wState = wrangler?.state || 'UNREACHABLE'
  // U1/U2 每通道独立：状态合法 + 带时刻 + UNREACHABLE 必须带原因
  push('U1', (gState === 'VERIFIED' || gState === 'UNREACHABLE') && !!graphql?.retrievedAt
    && (gState === 'VERIFIED' || String(graphql?.reason || '').length > 8),
    'U1 GraphQL 通道状态自证（VERIFIED/UNREACHABLE 二态 + 时刻 + 未取到时须给原因）',
    `${gState} @${graphql?.retrievedAt || '-'}${gState === 'UNREACHABLE' ? ` 原因=${graphql?.reason}` : ''}`)
  push('U2', (wState === 'VERIFIED' || wState === 'UNREACHABLE') && !!wrangler?.retrievedAt
    && (wState === 'VERIFIED' || String(wrangler?.reason || '').length > 8),
    'U2 wrangler CLI 通道状态自证（同上，两通道不合流）',
    `${wState} @${wrangler?.retrievedAt || '-'}${wState === 'UNREACHABLE' ? ` 原因=${wrangler?.reason}` : ''}`)

  // U8 窗口本身要成立：跨度恒 24h、nowIso 落在 today 窗内（防本轮那种"未来窗空集"）
  const span = Date.parse(windows.today_lt) - Date.parse(windows.today_geq)
  const inside = Date.parse(windows.today_geq) <= Date.parse(nowIso) && Date.parse(nowIso) < Date.parse(windows.today_lt)
  push('U8', span === 86_400_000 && inside && /T00:00:00Z$/.test(windows.today_geq),
    'U8 UTC 日界窗口自证（跨度=整天、取数时刻落在窗内、起点必是 00:00Z）',
    `${windows.today_geq} .. ${windows.today_lt}｜跨度 ${span / 3_600_000}h｜now=${nowIso} 在窗内=${inside}`)

  if (gState === 'UNREACHABLE' && wState === 'UNREACHABLE') {
    // 两通道都没读数 ⇒ 只能报"不知道"。这是本件唯一允许的失败出口，且 rc=2（不是 1）。
    push('U3', false, 'U3 两通道均无远端读数 ⇒ 累计用量仍不知道',
      `graphql=${graphql?.reason || '-'}｜wrangler=${wrangler?.reason || '-'}｜禁止折算成"配额安全"`)
    skip('U4', 'U4 日累计 ⇄ 免费档对账', '需要 VERIFIED 读数')
    skip('U5', 'U5 空集反差（跨通道互检）', '两通道都没读数，互检无从执行')
    skip('U6', 'U6 最重调用容量式自洽', '需要本机登记册，但登记册读不到时也照红')
    skip('U7', 'U7 登记册 remote_usage ⇄ 实测对账', '需要 VERIFIED 读数')
    return out
  }
  push('U3', true, 'U3 至少一条通道给出了远端读数（未折算）', `graphql=${gState}｜wrangler=${wState}`)

  const todayRead = gState === 'VERIFIED' ? sumOf(graphql.today, 'rowsRead') : null
  const todayWrite = gState === 'VERIFIED' ? sumOf(graphql.today, 'rowsWritten') : null
  const hist = gState === 'VERIFIED' ? byDate(graphql.history) : []
  const peakDay = hist.reduce((a, [d, v]) => (!a || v.rowsWritten > a[1].rowsWritten ? [d, v] : a), null)

  // U4 配额对账：读数直接除在册配额，出百分比与余量倍数（值必须写在行上，禁只出布尔）
  if (todayWrite === null) skip('U4', 'U4 日累计 ⇄ 免费档对账', 'GraphQL 通道未取到，只有滚动 24h 可用 ⇒ 记 SKIP 不判 SAFE')
  else push('U4', todayWrite <= DAILY_ROWS_WRITTEN_FREE && todayRead <= DAILY_ROWS_READ_FREE,
    'U4 日累计 ⇄ 免费档对账（写/读两把尺各自算，取不到的一侧不算过）',
    `UTC ${utcDay(nowIso)} 写 ${todayWrite}/${DAILY_ROWS_WRITTEN_FREE}=${(todayWrite / DAILY_ROWS_WRITTEN_FREE * 100).toFixed(3)}%`
    + `｜读 ${todayRead}/${DAILY_ROWS_READ_FREE}=${(todayRead / DAILY_ROWS_READ_FREE * 100).toFixed(3)}%`
    + (peakDay ? `｜7 日最忙写入日 ${peakDay[0]}=${peakDay[1].rowsWritten} 行` : ''))

  // U5 空集反差：一手（未来窗返回 200 + 空集 + 零报错）⇒ "日窗 0" 有两种成因，必须**分开判**：
  //   (a) 参数/窗口真的错（原靶子）；(b) UTC 日窗刚开，今天**确实**还没写。
  // 第二版初稿写成"日窗 0 而滚动 24h 非 0 ⇒ 一律可疑"，实测在 00:11 UTC（日窗刚开 11 分钟）
  // 把一次完全正常的取数判成 RED —— 而 D1 配额按 00:00 UTC 重置，每天头几小时必然落进这个形状，
  // 每天假红一次的判据下一轮就没人看了。修法不是加时间门（时间门=自己开一段盲区），
  // 而是拿**同一个请求里**的 history 腿做结构互检：它按 date 分组，能独立回答"今天有没有用量"。
  const wRoll = wrangler?.rolling
  if (gState === 'VERIFIED' && wState === 'VERIFIED') {
    const todayKey = utcDay(nowIso)
    const histMap = new Map(hist)
    const histToday = histMap.get(todayKey)
    const todayAny = (histToday?.rowsRead || 0) + (histToday?.rowsWritten || 0)
    const prevNonZero = hist.filter(([d]) => d !== todayKey).some(([, v]) => (v.rowsRead || 0) + (v.rowsWritten || 0) > 0)
    const elapsedMin = Math.round((Date.parse(nowIso) - Date.parse(windows.today_geq)) / 60_000)
    const emptyToday = todayRead === 0 && todayWrite === 0
    const rollingNonZero = (wRoll.rows_read_24h > 0 || wRoll.rows_written_24h > 0)
    const cross = `日窗 读=${todayRead} 写=${todayWrite}｜history 腿同日(${todayKey}) = 读=${histToday?.rowsRead ?? '无键'} 写=${histToday?.rowsWritten ?? '无键'}｜滚动 24h 读=${wRoll.rows_read_24h} 写=${wRoll.rows_written_24h}｜日窗已过 ${elapsedMin} 分钟`
    if (!emptyToday || !rollingNonZero) push('U5', true, 'U5 空集反差（日窗 ⇄ history 腿 ⇄ 滚动 24h 三向）', cross)
    else if (todayAny > 0) push('U5', false, 'U5 空集反差（日窗 ⇄ history 腿 ⇄ 滚动 24h 三向）',
      `${cross} ⇒ **同一请求**按 date 分组的那条腿说今天有 ${todayAny} 行，today 子查询却报 0 ⇒ 过滤参数/别名错，不是"还没用"`)
    else if (prevNonZero) push('U5', true, 'U5 空集反差（日窗 ⇄ history 腿 ⇄ 滚动 24h 三向）EARLY',
      `${cross} ⇒ 判"今天确实还没写"：history 腿在昨日及以前给过非零读数（查询形状可用），而它自己的同日键也是 0 —— 两腿同话。`
      + `本腿**没有**改用时间门：时间门会造出一段谁都不看的盲区`)
    else {
      // 三向都拿不到判别依据 ⇒ 这一腿是**失明**，不是"通过"。用 blind 标记，让 rc=2 而不是 rc=0
      // （`ok === null` 单独不够：两通道取不到时 U4~U7 本来就该 SKIP，那是另一件事，别混进来）。
      out.push({ id: 'U5', ok: null, blind: true, label: 'U5 空集反差（日窗 ⇄ history 腿 ⇄ 滚动 24h 三向）UNVERIFIED', detail: `${cross} ⇒ 两腿都说 0、滚动 24h 却非 0，无从判别是"刚过日界"还是"窗口取错" ⇒ 记未验证，不记绿` })
    }
  } else skip('U5', 'U5 空集反差（跨通道互检）', `只有一条通道有读数（graphql=${gState}/wrangler=${wState}）`)

  // U6 容量式自洽：登记册的 peakRowsWritten × callsPerDayAtPeak 必 ≤ 免费额（下界口径的算术闭合）
  const peak = local?.peakRowsWritten
  const cap = local?.callsPerDayAtPeak
  if (!Number.isInteger(peak) || !Number.isInteger(cap)) push('U6', false, 'U6 最重调用容量式自洽', `登记册缺 peakRowsWritten/callsPerDayAtPeak（${WRITE_QUOTA_FILE}）`)
  else push('U6', peak >= 1 && peak * cap <= DAILY_ROWS_WRITTEN_FREE && cap === Math.floor(DAILY_ROWS_WRITTEN_FREE / peak),
    'U6 最重调用容量式自洽（峰值 × 次数 ≤ 免费额，且次数 = floor(额/峰值)）',
    `${peak} 行/次 × ${cap} 次 = ${peak * cap} ≤ ${DAILY_ROWS_WRITTEN_FREE}｜floor 口径 ${Math.floor(DAILY_ROWS_WRITTEN_FREE / peak)}`)

  // U7 声明 ⇄ 实测：登记册若还写 UNVERIFIED，而本件已经取到读数 ⇒ 声明落后；反向（登记册吹 VERIFIED
  // 而本件取不到）同样红。两侧只比**状态**不比时刻（时刻进登记册会让这条变永红，本轮实测过）；
  // 推导口径与 A11 共用同一个函数（同一事实只许一处判）。
  const claimed = local?.remote_usage
  const truth = remoteUsageClaim({ channels: { graphql, wrangler }, retrievedAtUtc: nowIso }).claim
  push('U7', claimed === truth, 'U7 d1-write-quota.json 的 remote_usage 声明 ⇄ 本次实测对账',
    claimed === truth ? `两侧同态=${truth}` : `登记册写 ${claimed} 而实测为 ${truth} ⇒ 声明落后或虚报（禁手改登记册，A9 会判漂移；跑 --update-write-quota 重生）`)

  return out
}

export function verdictOf(rows) {
  if (rows.some((r) => r.ok === false)) return 'RED'
  if (rows.some((r) => r.blind === true)) return 'UNVERIFIED'
  const u4 = rows.find((r) => r.id === 'U4')
  return u4 && u4.ok === null ? 'UNREACHABLE' : 'OK'
}

async function run() {
  requireInputs('d1-remote-usage', [join(root, 'wrangler.toml'), WRITE_QUOTA_FILE])
  const writeOut = process.argv.includes('--write')
  const asJson = process.argv.includes('--json')
  const nowIso = new Date().toISOString()
  const windows = windowsFor(nowIso)
  const dbName = readDatabaseName()
  if (!dbName) bail('d1-remote-usage', 'wrangler.toml 里没有 database_name ⇒ 连查哪个库都不知道')

  const acc = resolveAccount()
  const tok = acc.ok ? readToken() : { ok: false, reason: `账户 ID 取不到：${acc.reason}` }
  const local = (() => { try { return JSON.parse(readFileSync(WRITE_QUOTA_FILE, 'utf8')) } catch { return null } })()

  const graphql = tok.ok && acc.ok
    ? await fetchGraphql(tok.token, acc.accountId, windows)
    : { state: 'UNREACHABLE', retrievedAt: nowIso, reason: tok.reason || acc.reason }
  const wrangler = fetchWrangler(dbName)

  const rows = evaluate({ graphql, wrangler, local, windows, nowIso })
  const failed = rows.filter((r) => r.ok === false)
  const skipped = rows.filter((r) => r.ok === null)
  for (const r of rows) console.log(`${r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP'}  ${r.label}${r.detail ? ` (${r.detail})` : ''}`)

  const verdict = verdictOf(rows)
  const bothBlind = graphql.state === 'UNREACHABLE' && wrangler.state === 'UNREACHABLE'
  const summary = {
    schema: 'chaoshi-d1-remote-usage-v1',
    retrievedAtUtc: nowIso,
    endpoint: GRAPHQL_ENDPOINT,
    accountResolvedVia: acc.via || null,
    databaseName: dbName,
    windowUtc: windows,
    quota: { rows_written_free_per_day: DAILY_ROWS_WRITTEN_FREE, rows_read_free_per_day: DAILY_ROWS_READ_FREE, resets: '00:00 UTC', source: 'cloudflare/cloudflare-docs src/content/partials/workers/d1-pricing.mdx:7-8,24' },
    channels: {
      graphql: { state: graphql.state, retrievedAt: graphql.retrievedAt, rowsRead: graphql.state === 'VERIFIED' ? sumOf(graphql.today, 'rowsRead') : null, rowsWritten: graphql.state === 'VERIFIED' ? sumOf(graphql.today, 'rowsWritten') : null, byDateUtc: graphql.state === 'VERIFIED' ? byDate(graphql.history) : [], reason: graphql.reason || null },
      wrangler: { state: wrangler.state, retrievedAt: wrangler.retrievedAt, rolling24h: wrangler.rolling || null, databaseId: wrangler.databaseId || null, reason: wrangler.reason || null },
    },
    verdict,
    legs: { total: rows.length, passed: rows.filter((r) => r.ok === true).length, failed: failed.length, skipped: skipped.length },
    failureIds: failed.map((f) => f.id),
  }
  if (asJson) console.log(JSON.stringify(summary, null, 2))
  if (writeOut) {
    // 路径走常量 ⇒ 本轮新加的 classifyRisk 常量腿必须能认出这是产物写入（R42-H2 的活体样本）
    writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2) + '\n')
    console.log(`[d1-remote-usage] 已写 ${relative(root, OUT_FILE)}（verdict=${verdict}）`)
  }
  console.log(`\n==== 结果: ${rows.filter((r) => r.ok === true).length} 通过 / ${failed.length} 失败 / ${skipped.length} 未验证 ｜ verdict=${verdict} ｜ 通道 graphql=${graphql.state} wrangler=${wrangler.state} ====`)
  if (bothBlind) {
    console.log(`[${SELF}] 远端累计用量取不到 ⇒ 按未验证退出（rc=2），不判"配额安全"`)
    process.exit(2)
  }
  // 三档退出码：红=1 / 失明=2 / 绿=0。**失明不得落到 0** —— U5 现在会产出第三种出口
  // （三向都拿不到判别依据），若沿用 `failed.length ? 1 : 0` 它就静默变绿。
  process.exit(failed.length ? 1 : verdict === 'UNVERIFIED' ? 2 : 0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((e) => { console.error('[d1-remote-usage] 判据自身异常:', e); process.exit(2) })
}
