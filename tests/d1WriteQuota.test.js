// 第四十一轮夹具：D1「行写入」第三把尺（A8/A8b/A9/A10）。
// 立它的读数（本机实测 @2026-09-28）：createOrder(10 件)=11 行、batchUpdate(10)=11、
// batchDelete(50)=1、seedReviews=21 ⇒ 平台 100,000 行写入/日 ÷ 峰值 21 ≈ 4,761 次最重调用/日。
// 判据只吃注入数据（evaluate 是纯函数），所以这里每条反例都不碰真仓、也不读本机 git 状态。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { evaluate, REGISTER, DAILY_ROWS_WRITTEN_FREE, ROWS_READ_MEASURABLE_LOCALLY } from '../scripts/check-d1-roundtrips.mjs'

const rows = (over = {}) => REGISTER.map((e, i) => ({
  name: e.name, fixedShape: Boolean(e.fixedShape), at: e.at,
  point: [{ n: e.at[0], statements: 1, roundTrips: 1, rowsWritten: 1 }, { n: e.at[1], statements: 2, roundTrips: 1, rowsWritten: 3 }],
  last: { n: e.at[1], statements: 2, roundTrips: 1, rowsWritten: 3 },
  rtSlope: 0, stSlope: 0, maxStatements: 2, maxRoundTrips: 1, maxRowsWritten: 3,
  ...(i === 0 ? over : {}),
}))
const quotaFor = (r, extra = {}) => ({
  daily_rows_written_free: DAILY_ROWS_WRITTEN_FREE,
  rows_read_measurable_local: ROWS_READ_MEASURABLE_LOCALLY,
  remote_usage: 'UNVERIFIED',
  actions: Object.fromEntries(r.map((x) => [x.name, x.maxRowsWritten])),
  ...extra,
})
const state = (out, id) => out.find((v) => v.id === id)
const base = () => evaluate({ rows: rows(), hits: [], sourcesCount: 3, quota: quotaFor(rows()) })

describe('行写入尺 · 正例', () => {
  it('四腿齐全：A8 有读数 / A8b 非全零 / A9 登记⇄实测相等 / A10 口径自洽', () => {
    const out = base()
    for (const id of ['A8', 'A8b', 'A9', 'A10']) expect(state(out, id)?.ok, id).toBe(true)
    expect(state(out, 'A10').detail).toContain(String(Math.floor(DAILY_ROWS_WRITTEN_FREE / 3)))
    expect(state(out, 'A10').detail).toContain('UNVERIFIED')
  })

  it('A10 印的是实测数字而不是布尔（门面行折叠会把尺退化成状态词）', () => {
    const d = state(base(), 'A10').detail
    expect(/\d{3,}/.test(d), d).toBe(true)
  })
})

describe('行写入尺 · 反例（每条只动一个变量，红因可归因）', () => {
  it('A8：少一个 action 的读数 ⇒ 红且点名比例', () => {
    const r = rows()
    delete r[1].maxRowsWritten
    const out = evaluate({ rows: r, hits: [], sourcesCount: 3, quota: quotaFor(r) })
    expect(state(out, 'A8').ok).toBe(false)
    expect(state(out, 'A8').detail).toContain(`${r.length - 1}/${r.length}`)
  })

  it('A8b：全体 0 行必须红——"读到 0"与"尺没接上"不得同形', () => {
    const r = rows().map((x) => ({ ...x, maxRowsWritten: 0 }))
    const out = evaluate({ rows: r, hits: [], sourcesCount: 3, quota: quotaFor(r) })
    expect(state(out, 'A8b').ok).toBe(false)
    expect(state(out, 'A8b').detail).toContain('没有判定力')
  })

  it('A9：登记册缺件 ⇒ 红并给出生成命令（缺产物不等于免检）', () => {
    const out = evaluate({ rows: rows(), hits: [], sourcesCount: 3, quota: null })
    expect(state(out, 'A9').ok).toBe(false)
    expect(state(out, 'A9').detail).toContain('--update-write-quota')
  })

  it('A9 三类不一致各自点名：漂移 / 幽灵 / 漏登', () => {
    const r = rows()
    const mk = (mut) => evaluate({ rows: r, hits: [], sourcesCount: 3, quota: mut(quotaFor(r), r) })
    const drift = mk((q) => ({ ...q, actions: { ...q.actions, [r[0].name]: q.actions[r[0].name] + 5 } }))
    expect(state(drift, 'A9').ok).toBe(false)
    expect(state(drift, 'A9').detail).toContain('漂移 1')
    expect(state(drift, 'A9').detail).toContain(r[0].name)
    const ghost = mk((q) => ({ ...q, actions: { ...q.actions, 'A:ghosted': 7 } }))
    expect(state(ghost, 'A9').detail).toContain('幽灵 1')
    const miss = mk((q, rr) => { const a = { ...q.actions }; delete a[rr[1].name]; return { ...q, actions: a } })
    expect(state(miss, 'A9').detail).toContain('漏登 1')
  })

  it('A10：把现网用量写成 OK 必须红（未验证不许折算成通过）；常量被改也得红', () => {
    const r = rows()
    const q = quotaFor(r)
    const a = state(evaluate({ rows: r, hits: [], sourcesCount: 3, quota: { ...q, remote_usage: 'OK' } }), 'A10')
    expect(a.ok).toBe(false)
    const b = state(evaluate({ rows: r, hits: [], sourcesCount: 3, quota: { ...q, daily_rows_written_free: 99999 } }), 'A10')
    expect(b.ok).toBe(false)
    const c = state(evaluate({ rows: r, hits: [], sourcesCount: 3, quota: { ...q, rows_read_measurable_local: true } }), 'A10')
    expect(c.ok).toBe(false)
  })

  it('未注入登记册 ⇒ A9 必须是 SKIP（detail 自证），与「查过但没有」的 FAIL 不同形', () => {
    const r = rows()
    const a = evaluate({ rows: r, hits: [], sourcesCount: 3 })
    expect(state(a, 'A9').ok).toBe(true)
    expect(state(a, 'A9').detail).toContain('SKIP，不是 PASS')
    expect(state(a, 'A10'), '未注入时不该出现 A10 的结论').toBeUndefined()
    const b = evaluate({ rows: r, hits: [], sourcesCount: 3, quota: null })
    expect(state(b, 'A9').ok).toBe(false)
  })

  it('在册清单非空是这个尺的前提（REGISTER 空了 A8 不许绿）', () => {
    expect(REGISTER.length).toBeGreaterThan(0)
    const out = evaluate({ rows: [], hits: [], sourcesCount: 3, quota: { daily_rows_written_free: DAILY_ROWS_WRITTEN_FREE, remote_usage: 'UNVERIFIED', rows_read_measurable_local: false, actions: {} } })
    expect(state(out, 'A8').ok).toBe(false)
    expect(state(out, 'A8b').ok).toBe(false)
    expect(state(out, 'A9').ok).toBe(false)
  })
})

describe('变异腿：把尺子改坏，夹具必须翻红', () => {
  it('M1 撤掉 A8b 的"全零即红"⇒ 同一份全 0 输入会被读成通过', () => {
    const r = rows().map((x) => ({ ...x, maxRowsWritten: 0 }))
    const out = evaluate({ rows: r, hits: [], sourcesCount: 3, quota: quotaFor(r) })
    // 变异面：只判"有没有读数"，不判"是否全零"
    const mutantA8 = r.length > 0 && r.every((x) => Number.isInteger(x.maxRowsWritten) && x.maxRowsWritten >= 0)
    expect(mutantA8).toBe(true)
    expect(state(out, 'A8b').ok, '真判据必须比变异面多拦这一类').toBe(false)
  })
})
