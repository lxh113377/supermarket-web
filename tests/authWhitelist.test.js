/**
 * 客户端字段白名单单测（真实导入 src/auth.ts，其再导出 src/api/fields.ts）
 *
 * 说明：src/api/fields.ts 的 pickProductFields 是客户端侧的商品字段整形，
 * 最终写入仍由服务端 pick（functions/lib/db.js，依 *_FIELDS 白名单）强制执行。
 * 这里保证客户端也不会把非白名单字段（如恶意注入的 totalAmount / _id）带去服务端。
 */
import { describe, it, expect } from 'vitest'
import {
  pickProductFields, PRODUCT_FIELDS,
  pickOrderFields, ORDER_FIELDS,
  pickReviewFields, REVIEW_FIELDS,
  pickSubmissionFields, SUBMISSION_FIELDS,
} from '../src/auth'
// 服务端白名单常量（ESM 具名导出，位于 functions/lib/shared.js，随迁移自旧 cloudfunctions/ 迁出），用于客户端↔服务端一致性校验
import * as shared from '../functions/lib/shared'

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
      'name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled',
      'order', 'image', 'images', 'description', 'reviews',
    ])
  })

  it('costPrice 透传：数字原样保留，undefined/空串不落字段', () => {
    expect(pickProductFields({ name: '可乐', costPrice: 3.14159 }))
      .toEqual({ name: '可乐', costPrice: 3.14159 })
    expect(pickProductFields({ name: '可乐', costPrice: undefined }))
      .toEqual({ name: '可乐' })
    // 表单层负责规整（空串→undefined 不落库、NaN 拒绝），白名单层只做透传
    expect(pickProductFields({ name: '可乐', costPrice: '' }))
      .toEqual({ name: '可乐', costPrice: '' })
  })
})

// ---------- 订单客户端白名单 ----------
describe('auth.js pickOrderFields 字段白名单（客户端）', () => {
  it('保留 roomNumber/items/wechat/remark/paymentScreenshot，丢弃 totalAmount / _id 等注入', () => {
    const input = {
      roomNumber: '301',
      items: [{ productId: 'p1', quantity: 2 }],
      wechat: 'wx_abc',
      remark: '少冰',
      paymentScreenshot: 'data:image/jpeg;base64,xxx',
      totalAmount: 999,
      _id: 'attacker',
      paidAt: '2026-01-01',
    }
    const out = pickOrderFields(input)
    expect(out).toEqual({
      roomNumber: '301',
      items: [{ productId: 'p1', quantity: 2 }],
      wechat: 'wx_abc',
      remark: '少冰',
      paymentScreenshot: 'data:image/jpeg;base64,xxx',
    })
    expect(out.totalAmount).toBeUndefined()
    expect(out._id).toBeUndefined()
  })

  it('building 自动映射为 roomNumber（防止下单字段再次错位）', () => {
    const input = {
      building: '36栋',
      wechat: 'wx',
      remark: '',
      items: [{ productId: 'p1', quantity: 1 }],
      paymentScreenshot: undefined,
    }
    const out = pickOrderFields(input)
    expect(out.roomNumber).toBe('36栋')
    expect(out.building).toBeUndefined()
    expect(out.wechat).toBe('wx')
  })

  it('空对象返回空', () => {
    expect(pickOrderFields({})).toEqual({})
  })
  it('客户端订单白名单含联系方式与截图字段', () => {
    expect(ORDER_FIELDS).toEqual(['roomNumber', 'items', 'wechat', 'remark', 'paymentScreenshot'])
  })
  it('客户端订单字段全部被服务端存储白名单覆盖', () => {
    expect(ORDER_FIELDS.every((f) => shared.ORDER_FIELDS.includes(f))).toBe(true)
  })
})

// ---------- 评价客户端白名单 ----------
describe('auth.js pickReviewFields 字段白名单（客户端）', () => {
  it('只保留 productOrder/user/rating/text/images，丢弃 _id/role 注入', () => {
    const input = {
      productOrder: 5, user: '小明', rating: 4, text: '好', images: ['data:image/jpeg;base64,a'],
      _id: 'attacker', status: 'approved', role: 'admin',
    }
    const out = pickReviewFields(input)
    expect(out).toEqual({ productOrder: 5, user: '小明', rating: 4, text: '好', images: ['data:image/jpeg;base64,a'] })
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
