/**
 * 事件时间线读接口单测（第六十二轮：event_log 读路径 getEventLog）。
 * 口径：断言 getEventTimeline 的输入校验与钳位，不断言 D1 本体 ——
 * 真 SQL 形态由 verify-backend 的 L24~L26（sqlite 实库）守，这里只证明
 * orderId 必填、limit 缺省/越界/非法三档归位、行原样返回。
 * DB 用最小假体（prepare/bind/all 三段式，与 actions/* 用的 D1 形态一致）。
 * 纯 import 单测，不起子进程 ⇒ 不进 CLI 腿守卫分母。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getEventTimeline } from '../functions/lib/actions/events.js'

const fakeDb = (rows) => ({
  seen: [],
  prepare(sql) {
    return {
      bind: (...args) => {
        this.seen.push({ sql, args })
        return { all: async () => ({ results: rows }) }
      },
    }
  },
})

const row = (status) => ({
  type: 'ORDER_STATUS_CHANGED', at: '2026-10-02T00:00:00.000Z', orderId: 'o_62',
  status, totalAmount: 12.5, discountAmount: 2, createdAt: '2026-10-02T00:00:00.000Z',
})

describe('getEventTimeline：event_log 按单查', () => {
  it('正常返回 orderId + events（行原样透传）', async () => {
    const db = fakeDb([row('paid'), row('done')])
    const r = await getEventTimeline(db, { orderId: 'o_62' })
    expect(r.code).toBe(0)
    expect(r.data.orderId).toBe('o_62')
    expect(r.data.events).toHaveLength(2)
    expect(db.seen[0].args).toEqual(['o_62', 50])
  })

  it('缺 orderId 带 missing_order_id 机器码（且一次 DB 都不碰）', async () => {
    const db = fakeDb([])
    const r = await getEventTimeline(db, {})
    expect(r.code).toBe(-1)
    expect(r.errorCode).toBe('missing_order_id')
    expect(db.seen).toHaveLength(0)
  })

  it('limit 三档归位：越界钳到 100、下限钳到 1、非法回缺省 50', async () => {
    const db = fakeDb([])
    await getEventTimeline(db, { orderId: 'o_62', limit: 9999 })
    await getEventTimeline(db, { orderId: 'o_62', limit: 0 })
    await getEventTimeline(db, { orderId: 'o_62', limit: 'nan' })
    expect(db.seen.map((s) => s.args[1])).toEqual([100, 1, 50])
  })
})
