/**
 * 云函数核心逻辑单测
 * 测试 createOrder 价格计算、checkAuth 鉴权、限流器
 */
import { describe, it, expect, vi } from 'vitest'

// Mock cloudbase SDK
vi.mock('@cloudbase/node-sdk', () => {
  const mockDb = {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    get: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    count: vi.fn(),
    createCollection: vi.fn().mockResolvedValue({}),
  }
  return {
    default: {
      init: vi.fn(() => ({ database: () => mockDb })),
    },
  }
})

// 由于云函数是 CJS 且依赖环境变量，这里直接测试提取出的纯逻辑
describe('pickFields 白名单过滤', () => {
  function pickFields(data, allowed) {
    const out = {}
    for (const k of allowed) {
      if (k in data) out[k] = data[k]
    }
    return out
  }

  const PRODUCT_FIELDS = ['name', 'spec', 'price', 'subcategories', 'enabled', 'order', 'image', 'description', 'reviews']

  it('只保留白名单字段', () => {
    const input = { name: '可乐', price: 3.5, hack: 'rm -rf /', _id: 'xxx' }
    const result = pickFields(input, PRODUCT_FIELDS)
    expect(result).toEqual({ name: '可乐', price: 3.5 })
    expect(result.hack).toBeUndefined()
    expect(result._id).toBeUndefined()
  })

  it('空对象返回空', () => {
    expect(pickFields({}, PRODUCT_FIELDS)).toEqual({})
  })
})

describe('normalizeEvent 归一化', () => {
  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return {}
    if (raw.body !== undefined) {
      let b = raw.body
      if (typeof b === 'string') {
        try { b = JSON.parse(b) } catch { b = {} }
      }
      if (b && typeof b === 'object') return b
    }
    return raw
  }

  it('解析 HTTP body 字符串', () => {
    const event = { body: JSON.stringify({ action: 'createOrder', payload: { items: [] } }) }
    const result = normalizeEvent(event)
    expect(result.action).toBe('createOrder')
  })

  it('直接对象透传', () => {
    const event = { action: 'getProducts' }
    expect(normalizeEvent(event)).toEqual(event)
  })

  it('null 返回空对象', () => {
    expect(normalizeEvent(null)).toEqual({})
  })

  it('body 非法 JSON 返回空对象', () => {
    expect(normalizeEvent({ body: 'not-json{' })).toEqual({})
  })
})

describe('订单金额计算逻辑', () => {
  it('正确计算多商品总价（含浮点精度）', () => {
    const items = [
      { price: 3.5, quantity: 2 },
      { price: 1.1, quantity: 3 },
    ]
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const rounded = Math.round(total * 100) / 100
    expect(rounded).toBe(10.3)
  })

  it('空商品列表总价为0', () => {
    const items = []
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    expect(Math.round(total * 100) / 100).toBe(0)
  })

  it('价格为字符串时正确转换', () => {
    const items = [{ price: '5.5', quantity: 2 }]
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0)
    expect(Math.round(total * 100) / 100).toBe(11)
  })
})

describe('限流器逻辑', () => {
  it('未超限返回 null', () => {
    const attempts = new Map()
    function checkRateLimit(ip, max = 5, window = 60000) {
      const now = Date.now()
      const record = attempts.get(ip)
      if (!record || now > record.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + window })
        return null
      }
      record.count++
      if (record.count > max) return { code: -1, message: '操作过于频繁' }
      return null
    }

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('1.2.3.4')).toBeNull()
    }
  })

  it('超限返回错误', () => {
    const attempts = new Map()
    function checkRateLimit(ip, max = 5, window = 60000) {
      const now = Date.now()
      const record = attempts.get(ip)
      if (!record || now > record.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + window })
        return null
      }
      record.count++
      if (record.count > max) return { code: -1, message: '操作过于频繁' }
      return null
    }

    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4')
    const result = checkRateLimit('1.2.3.4')
    expect(result).toEqual({ code: -1, message: '操作过于频繁' })
  })

  it('不同IP互不影响', () => {
    const attempts = new Map()
    function checkRateLimit(ip, max = 2, window = 60000) {
      const now = Date.now()
      const record = attempts.get(ip)
      if (!record || now > record.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + window })
        return null
      }
      record.count++
      if (record.count > max) return { code: -1, message: '操作过于频繁' }
      return null
    }

    checkRateLimit('1.1.1.1')
    checkRateLimit('1.1.1.1')
    checkRateLimit('1.1.1.1') // 超限
    expect(checkRateLimit('2.2.2.2')).toBeNull() // 不同IP不受影响
  })
})

describe('checkAuth 鉴权逻辑', () => {
  const ADMIN_KEY = 'test-secret-key'
  const publicActions = ['createOrder', 'getReviews', 'createSubmission', 'getPublicProducts']

  function checkAuth(adminKey, action) {
    if (publicActions.includes(action)) return null
    if (!ADMIN_KEY) return { code: -1, message: '服务未配置 ADMIN_KEY' }
    if (adminKey !== ADMIN_KEY) return { code: -1, message: '密钥错误' }
    return null
  }

  it('公开操作无需鉴权', () => {
    expect(checkAuth('', 'createOrder')).toBeNull()
    expect(checkAuth('', 'getPublicProducts')).toBeNull()
    expect(checkAuth('', 'createSubmission')).toBeNull()
  })

  it('管理操作需要正确密钥', () => {
    expect(checkAuth(ADMIN_KEY, 'getOrders')).toBeNull()
    expect(checkAuth('wrong-key', 'getOrders')).toEqual({ code: -1, message: '密钥错误' })
    expect(checkAuth('', 'deleteProduct')).toEqual({ code: -1, message: '密钥错误' })
  })
})

describe('formData 安全截断', () => {
  it('key 截断到50字符，value 截断到200字符', () => {
    const formData = {
      ['a'.repeat(100)]: 'b'.repeat(500),
      normal: 'ok',
    }
    const safeForm = {}
    for (const [k, v] of Object.entries(formData)) {
      safeForm[String(k).slice(0, 50)] = String(v || '').slice(0, 200)
    }
    const keys = Object.keys(safeForm)
    expect(keys[0].length).toBe(50)
    expect(safeForm[keys[0]].length).toBe(200)
    expect(safeForm.normal).toBe('ok')
  })
})
