/**
 * 事件落库单测（第六十轮 M-59-1）。
 * 口径：断言**消费者**的行为（drain → INSERT → 清空），不断言 D1 本体——
 * 真库形态由 verify:migrate-replay（A5 列一致）与 verify-backend（185+ 断言跑真 SQL）守，
 * 这里只证明 sink 把队列里的白名单字段原样存下、且任何失败都不影响响应路径。
 * DB 用最小假体（prepare/bind/run 三段式，与 actions/* 用的 D1 形态一致）。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { emit, drainEvents, ORDER_CREATED } from '../functions/lib/events.js'
import { drainAndStore, scheduleSink } from '../functions/lib/event_sink.js'

afterEach(() => { drainEvents(); vi.restoreAllMocks() })

const fakeDb = (rows, fail = null) => ({
  lastSql: '',
  prepare(sql) {
    this.lastSql = sql
    return {
      bind: (...args) => ({
        run: async () => {
          if (fail) throw fail
          rows.push(args)
          return {}
        },
      }),
    }
  },
})

const oneOrderEvent = () => emit(ORDER_CREATED, {
  orderId: 'o_60', status: 'pending', totalAmount: 12.5, discountAmount: 2,
})

describe('drainAndStore：队列 → event_log', () => {
  it('空队列零写盘（prepare 一次都不碰）', async () => {
    const db = fakeDb([])
    const prep = vi.spyOn(db, 'prepare')
    expect(await drainAndStore(db)).toEqual({ stored: 0 })
    expect(prep).not.toHaveBeenCalled()
  })
  it('一批事件逐条 INSERT，只存白名单 6 字段（列序与迁移一致）', async () => {
    oneOrderEvent()
    const rows = []
    const r = await drainAndStore(fakeDb(rows))
    expect(r).toEqual({ stored: 1 })
    expect(rows.length).toBe(1)
    const [type, at, orderId, status, total, discount, createdAt] = rows[0]
    expect(type).toBe('order.created')
    expect(orderId).toBe('o_60')
    expect(status).toBe('pending')
    expect(total).toBe(12.5)
    expect(discount).toBe(2)
    expect(typeof at).toBe('string')
    expect(typeof createdAt).toBe('string')
  })
  it('落完队列即空（同一批不会被存两次）', async () => {
    oneOrderEvent()
    const rows = []
    const db = fakeDb(rows)
    await drainAndStore(db)
    expect(await drainAndStore(db)).toEqual({ stored: 0 })
    expect(rows.length).toBe(1)
  })
  it('D1 未绑定：告警一行并丢弃，不抛（响应路径已定稿，绝不能被带下去）', async () => {
    oneOrderEvent()
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await drainAndStore(null)).toEqual({ stored: 0, reason: 'db_unbound' })
    expect(err).toHaveBeenCalled()
  })
})

describe('scheduleSink：调度永不影响主链路', () => {
  it('有 waitUntil 时任务交出去（不 await，不占响应延迟）', () => {
    oneOrderEvent()
    const held = []
    scheduleSink({ DB: fakeDb([]) }, (p) => held.push(p))
    expect(held.length).toBe(1)
    drainEvents()
  })
  it('落库抛错也被吞掉（无 unhandled rejection，响应不受影响）', async () => {
    oneOrderEvent()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    scheduleSink({ DB: fakeDb([], new Error('d1 down')) }, null)
    await new Promise((r) => setTimeout(r, 50))
    expect(err).toHaveBeenCalled()
    drainEvents()
  })
})
