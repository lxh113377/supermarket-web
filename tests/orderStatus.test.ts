/**
 * 订单履约状态机单测（2026-09-24 对标补齐）
 * 核心防线：前端迁移表与后端 functions 迁移表必须逐字段一致——
 * 云端由服务端强制、本地演示模式由 src/auth.ts 强制，两处共用本表。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/cloudbase', () => ({ IS_CLOUD: false }))

import {
  ORDER_TRANSITIONS, ORDER_STATUS_LABELS, ORDER_FLOW,
  canTransitionOrder, nextOrderStatuses, orderStatusLabel,
} from '../src/utils/orderStatus'
// 后端权威实现（纯 ESM，无 Cloudflare 运行时依赖，可在 node/jsdom 直接 import）
import { ORDER_TRANSITIONS as BE_TRANSITIONS } from '../functions/lib/actions/orders.js'
import { addLocalOrder } from '../src/localStore'
import { updateOrderStatus } from '../src/auth'

describe('前后端迁移表单源一致（parity）', () => {
  it('ORDER_TRANSITIONS 与后端 ORDER_TRANSITIONS 深度相等', () => {
    expect(ORDER_TRANSITIONS).toEqual(BE_TRANSITIONS)
  })
})

describe('状态机迁移规则', () => {
  it('主链四步全部合法', () => {
    expect(canTransitionOrder('pending', 'paid')).toBe(true)
    expect(canTransitionOrder('paid', 'delivering')).toBe(true)
    expect(canTransitionOrder('delivering', 'completed')).toBe(true)
  })
  it('三个进行态均可取消，取消可回 pending（误取消恢复）', () => {
    expect(canTransitionOrder('pending', 'cancelled')).toBe(true)
    expect(canTransitionOrder('paid', 'cancelled')).toBe(true)
    expect(canTransitionOrder('delivering', 'cancelled')).toBe(true)
    expect(canTransitionOrder('cancelled', 'pending')).toBe(true)
  })
  it('跨态与回退全部被拒', () => {
    expect(canTransitionOrder('pending', 'delivering')).toBe(false)
    expect(canTransitionOrder('pending', 'completed')).toBe(false)
    expect(canTransitionOrder('paid', 'completed')).toBe(false)
    expect(canTransitionOrder('paid', 'pending')).toBe(false)
    expect(canTransitionOrder('completed', 'paid')).toBe(false)
    expect(canTransitionOrder('completed', 'cancelled')).toBe(false)
    expect(canTransitionOrder('bogus', 'paid')).toBe(false)
  })
  it('nextOrderStatuses 含当前态 + 仅合法目标；终态只有自身', () => {
    expect(nextOrderStatuses('paid')).toEqual(['paid', 'delivering', 'cancelled'])
    expect(nextOrderStatuses('completed')).toEqual(['completed'])
  })
  it('主链与旁路终态均有中文标签，未知值原样透出', () => {
    for (const s of [...ORDER_FLOW, 'cancelled']) expect(orderStatusLabel(s)).not.toBe(s)
    expect(orderStatusLabel('weird')).toBe('weird')
    expect(Object.keys(ORDER_STATUS_LABELS).length).toBe(5)
  })
})

describe('本地演示模式同规则强制（src/auth.ts）', () => {
  beforeEach(() => localStorage.clear())
  it('非法迁移返回 code:-1，合法迁移返回 ok', async () => {
    const o = addLocalOrder({
      roomNumber: '501', items: [{ productId: 'p1', name: '可乐', price: 3, quantity: 1 }], totalAmount: 3,
    })
    const bad = await updateOrderStatus(o._id, 'delivering')
    expect('code' in bad && bad.code).toBe(-1)
    const good = await updateOrderStatus(o._id, 'paid')
    expect(good).toEqual({ ok: true })
    const { getLocalOrders } = await import('../src/localStore')
    expect(getLocalOrders().find((x) => x._id === o._id)?.status).toBe('paid')
  })
})
