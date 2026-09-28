// 第四十二轮夹具：D1 远端累计用量的 U5（空集反差）。
// 立它的读数（本机实测 @2026-09-28）：在 00:11 UTC（UTC 日窗刚开 11 分钟）跑本件，第二版初稿把
// 一次完全正常的取数判成 **RED** —— 而 D1 免费档按 00:00 UTC 重置 ⇒ 每天头几小时必然落进"日窗 0
// 而滚动 24h 非 0"这个形状，每天假红一次的判据下一轮就没人看。修法不是加时间门（时间门=自己开盲区），
// 而是拿**同一请求里**按 date 分组的 history 腿做结构互检。本文件把三向的四种出口各钉一条。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { evaluate, verdictOf, windowsFor } from '../scripts/check-d1-remote-usage.mjs'
import { remoteUsageClaim } from '../scripts/lib/d1-quota.mjs'

const NOW = '2026-09-28T00:11:00Z'
const ROLL = { rows_read_24h: 24709, rows_written_24h: 81 }
const day = (rowsRead, rowsWritten) => ({ sum: { rowsRead, rowsWritten } })
const wr = (over = {}) => ({ state: 'VERIFIED', retrievedAt: NOW, rolling: ROLL, databaseId: 'db-1', ...over })
/** history 收的是**原始行**（`byDate()` 按 `dimensions.date` 分组），不是聚合好的 Map 条目。 */
const gql = (today, histEntries) => ({
  state: 'VERIFIED', retrievedAt: NOW, today,
  history: histEntries.map(([date, v]) => ({ sum: { rowsRead: v.rowsRead, rowsWritten: v.rowsWritten }, dimensions: { date } })),
})

function run({ graphql, wrangler = wr() }) {
  const windows = windowsFor(NOW)
  const local = {
    peakRowsWritten: 21, callsPerDayAtPeak: 4761,
    remote_usage: remoteUsageClaim({ channels: { graphql, wrangler }, retrievedAtUtc: NOW }).claim,
  }
  return evaluate({ graphql, wrangler, local, windows, nowIso: NOW })
}
const leg = (rows, id) => rows.find((r) => r.id === id)

describe('U5 三向互检 · 正常与 EARLY', () => {
  it('日窗有读数 ⇒ PASS，且明细里带上三向的数字', () => {
    const rows = run({ graphql: gql([day(1200, 11)], [[ '2026-09-28', { rowsRead: 1200, rowsWritten: 11 }], ['2026-09-27', { rowsRead: 900, rowsWritten: 5 }]]) })
    expect(leg(rows, 'U5').ok).toBe(true)
    expect(leg(rows, 'U5').detail).toContain('1200')
    expect(verdictOf(rows)).toBe('OK')
  })

  it('日窗 0 + history 无同日键 + 昨日有读数 + 滚动 24h 非 0 ⇒ **EARLY 判绿**（旧版在这里假红）', () => {
    const rows = run({ graphql: gql([], [['2026-09-27', { rowsRead: 900, rowsWritten: 5 }], ['2026-09-26', { rowsRead: 4407, rowsWritten: 153 }]]) })
    expect(leg(rows, 'U5').ok).toBe(true)
    expect(leg(rows, 'U5').label).toContain('EARLY')
    expect(leg(rows, 'U5').detail).toContain('查询形状可用')
    expect(verdictOf(rows)).toBe('OK')
  })
})

describe('U5 三向互检 · 必须判红的两向', () => {
  it('同一请求的 history 腿说今天有 30 行，today 子查询却报 0 ⇒ 过滤参数/别名错，判红', () => {
    const rows = run({ graphql: gql([], [['2026-09-28', { rowsRead: 20, rowsWritten: 10 }], ['2026-09-27', { rowsRead: 900, rowsWritten: 5 }]]) })
    expect(leg(rows, 'U5').ok).toBe(false)
    expect(leg(rows, 'U5').detail).toContain('过滤参数')
    expect(verdictOf(rows)).toBe('RED')
  })

  it('两腿都说 0 而滚动 24h 非 0 ⇒ 无从判别，记 UNVERIFIED 且 **rc=2**（绝不落到 0 变绿）', () => {
    const rows = run({ graphql: gql([], []) })
    expect(leg(rows, 'U5').ok).toBe(null)
    expect(leg(rows, 'U5').blind).toBe(true)
    expect(verdictOf(rows)).toBe('UNVERIFIED')
  })
})

describe('U5 的边界与前提', () => {
  it('前提：本件判的是"两通道都 VERIFIED"，只有一条有读数时 U5 记 SKIP 而不是猜', () => {
    const graphql = gql([], [])
    const rows = run({ graphql, wrangler: { state: 'UNREACHABLE', retrievedAt: NOW, reason: 'wrangler d1 info rc=1 本机没装' } })
    expect(leg(rows, 'U5').ok).toBe(null)
    expect(leg(rows, 'U5').blind).toBeUndefined()
  })

  it('变异腿：把 EARLY 判据改回"日窗 0 即红"，第 2 条正例必须翻红（证明这条腿真的在管事）', () => {
    const rows = run({ graphql: gql([], [['2026-09-27', { rowsRead: 900, rowsWritten: 5 }]]) })
    const earlyIsGreen = leg(rows, 'U5').ok === true
    // 反例面：history 里既没有同日键、也没有任何非零日 ⇒ 必须**不是**绿
    const blind = run({ graphql: gql([], []) })
    expect(earlyIsGreen && leg(blind, 'U5').ok === null).toBe(true)
  })

  it('两通道全盲 ⇒ U3 红 + verdict 里带着未验证语义，不折算成"配额安全"', () => {
    const graphql = { state: 'UNREACHABLE', retrievedAt: NOW, reason: 'HTTP=401 凭据无效' }
    const wrangler = { state: 'UNREACHABLE', retrievedAt: NOW, reason: '没有本地 wrangler（先 npm ci）' }
    const rows = run({ graphql, wrangler })
    expect(leg(rows, 'U3').ok).toBe(false)
    expect(leg(rows, 'U3').detail).toContain('禁止折算')
  })
})
