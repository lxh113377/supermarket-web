/**
 * 客户端字段白名单单测（真实导入 src/auth.js）
 *
 * 说明：src/auth.js 的 pickProductFields 是客户端侧的商品字段整形，
 * 最终写入仍由服务端 pickFields 强制执行（见 cloudfunctions/admin-api/index.test.js）。
 * 这里保证客户端也不会把非白名单字段（如恶意注入的 totalAmount / _id）带去服务端。
 */
import { describe, it, expect } from 'vitest'
import { pickProductFields, PRODUCT_FIELDS } from '../src/auth.js'

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
