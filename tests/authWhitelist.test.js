/**
 * 客户端字段白名单单测（真实导入 src/auth.js）
 *
 * 说明：src/auth.js 的 pickProductFields 是客户端侧的商品字段整形，
 * 最终写入仍由服务端 pickFields 强制执行（见 cloudfunctions/admin-api/index.test.js）。
 * 这里保证客户端也不会把非白名单字段（如恶意注入的 totalAmount / _id）带去服务端。
 */
import { describe, it, expect } from 'vitest'
import {
  pickProductFields, PRODUCT_FIELDS,
  pickOrderFields, ORDER_FIELDS,
  pickReviewFields, REVIEW_FIELDS,
  pickSubmissionFields, SUBMISSION_FIELDS,
} from '../src/auth.js'
// 服务端白名单常量（CJS，default 导入即 module.exports），用于客户端↔服务端一致性校验
import shared from '../cloudfunctions/shared.js'

describe('auth.js pickProductFields 字段白名单（客户端）', () => {
  it('只保留白名单字段，丢弃恶意注入字段', () => {
    const input = {
      name: '可乐',
      price: 3.5,
      hack: 'rm -rf /',
      _id: 'attacker',
      totalAmount: 0.01,
    }
    const out = pickProductFields(input)
    expect(out).toEqual({ name: '可乐', price: 3.5 })
    expect(out.hack).toBeUndefined()
    expect(out._id).toBeUndefined()
    expect(out.totalAmount).toBeUndefined()
  })

  it('空对象返回空', () => {
    expect(pickProductFields({})).toEqual({})
  })

  it('白名单集合与服务端一致（ defence in depth ）', () => {
    expect(PRODUCT_FIELDS).toEqual([
      'name', 'spec', 'price', 'subcategories', 'enabled',
      'order', 'image', 'description', 'reviews',
    ])
  })
})

// ---------- 订单客户端白名单 ----------
describe('auth.js pickOrderFields 字段白名单（客户端）', () => {
  it('只保留 roomNumber / items，丢弃 totalAmount / _id 等注入', () => {
    const input = {
      roomNumber: '301',
      items: [{ productId: 'p1', quantity: 2 }],
      totalAmount: 999,
      _id: 'attacker',
      paidAt: '2026-01-01',
    }
    const out = pickOrderFields(input)
    expect(out).toEqual({ roomNumber: '301', items: [{ productId: 'p1', quantity: 2 }] })
    expect(out.totalAmount).toBeUndefined()
    expect(out._id).toBeUndefined()
  })
  it('空对象返回空', () => {
    expect(pickOrderFields({})).toEqual({})
  })
  it('客户端订单白名单只含输入字段 roomNumber/items', () => {
    expect(ORDER_FIELDS).toEqual(['roomNumber', 'items'])
  })
})

// ---------- 评价客户端白名单 ----------
describe('auth.js pickReviewFields 字段白名单（客户端）', () => {
  it('只保留 productOrder/user/rating/text，丢弃 _id/role 注入', () => {
    const input = {
      productOrder: 5, user: '小明', rating: 4, text: '好',
      _id: 'attacker', status: 'approved', role: 'admin',
    }
    const out = pickReviewFields(input)
    expect(out).toEqual({ productOrder: 5, user: '小明', rating: 4, text: '好' })
    expect(out._id).toBeUndefined()
    expect(out.status).toBeUndefined()
  })
  it('白名单集合与服务端一致（defence in depth）', () => {
    expect(REVIEW_FIELDS).toEqual(shared.REVIEW_FIELDS)
  })
})

// ---------- 服务提交客户端白名单 ----------
describe('auth.js pickSubmissionFields 字段白名单（客户端）', () => {
  it('只保留白名单顶层字段，丢弃 _id/status/role 注入', () => {
    const input = {
      serviceId: 's1', serviceName: '维修',
      categoryId: 'c1', categoryName: '家电',
      formData: { desc: '漏水' }, images: ['x'],
      _id: 'attacker', status: 'done', role: 'admin',
    }
    const out = pickSubmissionFields(input)
    expect(out).toEqual({
      serviceId: 's1', serviceName: '维修',
      categoryId: 'c1', categoryName: '家电',
      formData: { desc: '漏水' }, images: ['x'],
    })
    expect(out._id).toBeUndefined()
    expect(out.status).toBeUndefined()
  })
  it('白名单集合与服务端一致（defence in depth）', () => {
    expect(SUBMISSION_FIELDS).toEqual(shared.SUBMISSION_FIELDS)
  })
})
