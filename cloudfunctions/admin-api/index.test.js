/**
 * 云函数核心逻辑单测（真实导入被测模块，不再复制逻辑）
 *
 * 关键改进：此前本文件把 pickFields / createOrderHandler / checkAuth / 限流器等
 * 逻辑「内联复制」一遍再测，逻辑一旦在 shared.js / index.js 中改动，测试不会报错，
 * 等于没测——这正是代码审查标准 §4 标 🔴 的漏洞。
 * 现在改为直接从 ./index.js 与 ./shared.js 导入真实实现，测试随真实代码演进。
 *
 * 覆盖：pickFields 白名单、createOrderHandler 服务端金额重算、checkAuth 鉴权、
 *       createRateLimiter 限流、normalizeEvent 归一化、getClientIp、createSubmissionHandler 表单截断。
 */
import { describe, it, expect, vi } from 'vitest'

// Mock cloudbase SDK：ENV_ID 未配置时 index.js 根本不会调用 init，这里仅为稳妥
vi.mock('@cloudbase/node-sdk', () => ({
  default: { init: vi.fn(() => ({ database: () => ({}) })) },
}))

import indexMod from './index.js'
import shared from './shared.js'

const { pickFields, PRODUCT_FIELDS, checkAuth, seedReviewsHandler } = indexMod
const {
  createOrderHandler,
  createRateLimiter,
  normalizeEvent,
  getClientIp,
  createSubmissionHandler,
  addReviewHandler,
  getReviewsHandler,
  ORDER_FIELDS,
  REVIEW_FIELDS,
  SUBMISSION_FIELDS,
} = shared

// ---------- pickFields 白名单（服务端商品字段过滤） ----------
describe('pickFields 白名单过滤（服务端）', () => {
  it('只保留白名单字段，丢弃恶意注入字段', () => {
    const input = {
      name: '可乐',
      price: 3.5,
      totalAmount: 0.01, // 客户端试图篡改金额
      role: 'admin', // 越权注入
      isAdmin: true,
      _id: 'attacker',
    }
    const result = pickFields(input, PRODUCT_FIELDS)
    expect(result).toEqual({ name: '可乐', price: 3.5 })
    expect(result.totalAmount).toBeUndefined()
    expect(result.role).toBeUndefined()
    expect(result.isAdmin).toBeUndefined()
    expect(result._id).toBeUndefined()
  })

  it('空对象返回空', () => {
    expect(pickFields({}, PRODUCT_FIELDS)).toEqual({})
  })

  it('白名单严格等于预定义字段集合', () => {
    expect(PRODUCT_FIELDS).toEqual([
      'name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled',
      'order', 'image', 'images', 'description', 'reviews',
    ])
  })

  it('costPrice 白名单透传：数字保留，undefined 不落字段', () => {
    expect(pickFields({ name: '可乐', price: 3.5, costPrice: 2.2, hack: 1 }, PRODUCT_FIELDS))
      .toEqual({ name: '可乐', price: 3.5, costPrice: 2.2 })
    expect(pickFields({ name: '可乐', costPrice: undefined }, PRODUCT_FIELDS))
      .toEqual({ name: '可乐' })
  })

  it('各实体字段白名单常量与预期一致（ORDER/REVIEW/SUBMISSION_FIELDS）', () => {
    expect(ORDER_FIELDS).toEqual([
      'roomNumber', 'items', 'totalAmount', 'status', 'createdAt', 'updatedAt',
      'wechat', 'remark', 'paymentScreenshot',
    ])
    expect(REVIEW_FIELDS).toEqual(['productOrder', 'user', 'rating', 'text', 'images'])
    expect(SUBMISSION_FIELDS).toEqual(['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images'])
  })

  it('REVIEW_FIELDS 经 pickFields 只取允许字段，丢弃 _id/status/role 注入', () => {
    const pl = {
      productOrder: 5, user: '小明', rating: 4, text: '好', images: ['x'],
      _id: 'hack', status: 'approved', role: 'admin',
    }
    expect(pickFields(pl, REVIEW_FIELDS)).toEqual({ productOrder: 5, user: '小明', rating: 4, text: '好', images: ['x'] })
  })
})

// ---------- createOrderHandler 服务端金额重算（防客户端篡改价格） ----------
function makeMockDb(productsFixture) {
  const productsCollection = {
    where: vi.fn(() => productsCollection),
    field: vi.fn(() => productsCollection),
    get: vi.fn().mockResolvedValue({ data: productsFixture }),
  }
  const ordersCollection = {
    add: vi.fn().mockResolvedValue({ id: 'order_1' }),
  }
  return {
    command: { in: (arr) => ({ $in: arr }) },
    collection: vi.fn((name) => {
      if (name === 'sm_products') return productsCollection
      if (name === 'sm_orders') return ordersCollection
      return { get: vi.fn().mockResolvedValue({ data: [] }), add: vi.fn().mockResolvedValue({ id: 'x' }) }
    }),
    _orders: ordersCollection,
  }
}

describe('createOrderHandler 服务端金额重算', () => {
  const products = [
    { _id: 'p1', name: '可乐', spec: '330ml', price: 3.5, enabled: true },
    { _id: 'p2', name: '薯片', spec: '大包', price: 6.0, enabled: true },
  ]

  it('用服务端价格重算，忽略客户端传入的 price', async () => {
    const db = makeMockDb(products)
    const payload = {
      roomNumber: '301',
      items: [{ productId: 'p1', name: '可乐', price: 0.01, quantity: 2 }],
    }
    const res = await createOrderHandler(db, payload)
    expect(res.code).toBe(0)
    // 3.5 * 2 = 7，不是 0.01*2 = 0.02
    expect(res.data.totalAmount).toBe(7)
    // 落库订单的金额也必须用服务端价格
    const saved = db._orders.add.mock.calls[0][0]
    expect(saved.totalAmount).toBe(7)
    expect(saved.items[0].price).toBe(3.5)
  })

  it('多商品总价正确求和', async () => {
    const db = makeMockDb(products)
    const payload = {
      roomNumber: '302',
      items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 1 }],
    }
    const res = await createOrderHandler(db, payload)
    expect(res.data.totalAmount).toBe(9.5)
  })

  it('字符串 quantity 也能正确相乘', async () => {
    const db = makeMockDb(products)
    const payload = { roomNumber: '303', items: [{ productId: 'p1', quantity: '3' }] }
    const res = await createOrderHandler(db, payload)
    expect(res.data.totalAmount).toBe(10.5) // 3.5*3
  })

  it('商品不存在时报错', async () => {
    const db = makeMockDb(products)
    const res = await createOrderHandler(db, { roomNumber: '304', items: [{ productId: 'nope', quantity: 1 }] })
    expect(res.code).toBe(-1)
    expect(res.message).toContain('商品不存在')
  })

  it('已下架商品报错', async () => {
    const db = makeMockDb([{ ...products[0], enabled: false }])
    const res = await createOrderHandler(db, { roomNumber: '305', items: [{ productId: 'p1', quantity: 1 }] })
    expect(res.code).toBe(-1)
    expect(res.message).toContain('已下架')
  })

  it('缺少 roomNumber 或空 items 视为数据不完整', async () => {
    const db = makeMockDb(products)
    expect((await createOrderHandler(db, { items: [] })).code).toBe(-1)
    expect((await createOrderHandler(db, { roomNumber: '306' })).code).toBe(-1)
  })

  it('落库订单只保留服务端校验后的字段，丢弃客户端注入', async () => {
    const db = makeMockDb(products)
    const payload = {
      roomNumber: '307',
      items: [{ productId: 'p1', price: 0.01, totalAmount: 1, role: 'admin', quantity: 1 }],
    }
    await createOrderHandler(db, payload)
    const saved = db._orders.add.mock.calls[0][0]
    expect(saved.items[0]).toEqual({
      productId: 'p1', name: '可乐', spec: '330ml', price: 3.5, quantity: 1, subcategories: [],
    })
    expect(saved.items[0].role).toBeUndefined()
    expect(saved.totalAmount).toBe(3.5)
  })

  it('落库文档只含 ORDER_FIELDS 白名单字段，注入字段被丢弃', async () => {
    const db = makeMockDb(products)
    await createOrderHandler(db, {
      roomNumber: '307',
      _id: 'hack', status: 'paid', role: 'admin',
      items: [{ productId: 'p1', quantity: 1 }],
    })
    const saved = db._orders.add.mock.calls[0][0]
    expect(Object.keys(saved).every((k) => ORDER_FIELDS.includes(k))).toBe(true)
    expect(saved._id).toBeUndefined()
    expect(saved.status).toBe('pending') // 服务端强制，非来自客户端
  })

  it('保存 wechat/remark/paymentScreenshot 并带上 subcategories', async () => {
    const db = makeMockDb(products)
    const payload = {
      roomNumber: '36栋',
      wechat: 'wx_abc',
      remark: '少冰',
      paymentScreenshot: 'data:image/jpeg;base64,xxx',
      items: [{ productId: 'p1', quantity: 2 }],
    }
    const res = await createOrderHandler(db, payload)
    expect(res.code).toBe(0)
    const saved = db._orders.add.mock.calls[0][0]
    expect(saved.roomNumber).toBe('36栋')
    expect(saved.wechat).toBe('wx_abc')
    expect(saved.remark).toBe('少冰')
    expect(saved.paymentScreenshot).toBe('data:image/jpeg;base64,xxx')
    expect(saved.items[0].subcategories).toEqual([])
  })

  it('订单 items 携带商品 subcategories 供看板分类统计', async () => {
    const db = makeMockDb([{ ...products[0], subcategories: ['sweet'] }])
    const res = await createOrderHandler(db, {
      roomNumber: '36栋',
      items: [{ productId: 'p1', quantity: 1 }],
    })
    expect(res.code).toBe(0)
    const saved = db._orders.add.mock.calls[0][0]
    expect(saved.items[0].subcategories).toEqual(['sweet'])
  })

  it('wechat/remark 超长截断，paymentScreenshot 超 800KB 拒绝', async () => {
    const db = makeMockDb(products)
    const ok = await createOrderHandler(db, {
      roomNumber: '1',
      wechat: 'w'.repeat(100),
      remark: 'r'.repeat(300),
      items: [{ productId: 'p1', quantity: 1 }],
    })
    expect(ok.code).toBe(0)
    const saved = db._orders.add.mock.calls[0][0]
    expect(saved.wechat.length).toBe(50)
    expect(saved.remark.length).toBe(200)

    const bad = await createOrderHandler(db, {
      roomNumber: '1',
      paymentScreenshot: 'x'.repeat(800 * 1024 + 1),
      items: [{ productId: 'p1', quantity: 1 }],
    })
    expect(bad.code).toBe(-1)
    expect(bad.message).toContain('截图过大')
  })
})

// ---------- addReviewHandler 评价提交（公开 + 管理共用） ----------
describe('addReviewHandler 评价提交', () => {
  function makeDb() {
    const reviews = { add: vi.fn().mockResolvedValue({ id: 'rev_1' }) }
    return {
      createCollection: vi.fn().mockResolvedValue({}),
      collection: vi.fn((name) => (name === 'sm_reviews' ? reviews : { add: vi.fn(), get: vi.fn() })),
      _reviews: reviews,
    }
  }

  it('评分钳制 1-5、昵称截断 20、文本截断 500', async () => {
    const db = makeDb()
    const res = await addReviewHandler(db, {
      productOrder: '3',
      user: 'u'.repeat(100),
      rating: 99,
      text: 't'.repeat(600),
    })
    expect(res.code).toBe(0)
    const saved = db._reviews.add.mock.calls[0][0]
    expect(saved.productOrder).toBe(3)
    expect(saved.rating).toBe(5)
    expect(saved.user.length).toBe(20)
    expect(saved.text.length).toBe(500)
  })

  it('评分低于 1 时钳制为 1', async () => {
    const db = makeDb()
    const res = await addReviewHandler(db, { productOrder: 1, rating: -3, text: 'x' })
    expect(res.code).toBe(0)
    expect(db._reviews.add.mock.calls[0][0].rating).toBe(1)
  })

  it('images 最多 5 张、单张 ≤2MB，超限拒绝', async () => {
    const db = makeDb()
    const tooMany = await addReviewHandler(db, {
      productOrder: 1,
      images: Array.from({ length: 6 }, (_, i) => `img${i}`),
    })
    expect(tooMany.code).toBe(-1)

    const tooBig = await addReviewHandler(db, {
      productOrder: 1,
      images: ['x'.repeat(2 * 1024 * 1024 + 1)],
    })
    expect(tooBig.code).toBe(-1)

    const ok = await addReviewHandler(db, {
      productOrder: 1,
      images: ['a', 'b'],
    })
    expect(ok.code).toBe(0)
    expect(db._reviews.add.mock.calls.at(-1)[0].images).toEqual(['a', 'b'])
  })

  it('缺少 productOrder 报错', async () => {
    const db = makeDb()
    const res = await addReviewHandler(db, { text: 'x' })
    expect(res.code).toBe(-1)
  })
})

// ---------- getReviewsHandler 评价读取 ----------
describe('getReviewsHandler 评价读取', () => {
  it('productOrder 强制 Number 且投影包含 images', async () => {
    const reviews = {
      where: vi.fn(() => reviews),
      orderBy: vi.fn(() => reviews),
      limit: vi.fn(() => reviews),
      field: vi.fn(() => reviews),
      get: vi.fn().mockResolvedValue({ data: [{ productOrder: 3, images: ['x'] }] }),
    }
    const db = { createCollection: vi.fn().mockResolvedValue({}), collection: vi.fn(() => reviews) }
    const res = await getReviewsHandler(db, { productOrder: '3' })
    expect(res.code).toBe(0)
    expect(reviews.where).toHaveBeenCalledWith({ productOrder: 3 })
    expect(reviews.field.mock.calls[0][0].images).toBe(true)
  })

  it('缺少 productOrder 报错', async () => {
    const db = { createCollection: vi.fn(), collection: vi.fn() }
    expect((await getReviewsHandler(db, {})).code).toBe(-1)
  })
})

// ---------- seedReviewsHandler 种子评价导入（幂等） ----------
describe('seedReviewsHandler 种子评价导入', () => {
  function makeDb(total) {
    const reviews = {
      count: vi.fn().mockResolvedValue({ total }),
      add: vi.fn().mockResolvedValue({ id: 'seed_1' }),
    }
    return {
      createCollection: vi.fn().mockResolvedValue({}),
      collection: vi.fn((name) => (name === 'sm_reviews' ? reviews : { count: vi.fn().mockResolvedValue({ total: 0 }), add: vi.fn() })),
      _reviews: reviews,
    }
  }

  it('集合为空时导入 20 条种子评价', async () => {
    const db = makeDb(0)
    const res = await seedReviewsHandler(db)
    expect(res.code).toBe(0)
    expect(res.data.added).toBe(20)
    expect(db._reviews.add).toHaveBeenCalledTimes(20)
    const first = db._reviews.add.mock.calls[0][0]
    expect(first.productOrder).toBe(1)
    expect(first.rating).toBeGreaterThanOrEqual(1)
    expect(first.rating).toBeLessThanOrEqual(5)
  })

  it('集合非空时不重复导入', async () => {
    const db = makeDb(3)
    const res = await seedReviewsHandler(db)
    expect(res.code).toBe(0)
    expect(res.data.added).toBe(0)
    expect(db._reviews.add).not.toHaveBeenCalled()
  })
})

// ---------- checkAuth 鉴权（真实模块逻辑） ----------
describe('checkAuth 鉴权逻辑', () => {
  const publicActions = ['createOrder', 'getReviews', 'createSubmission', 'addPublicReview', 'getPublicProducts', 'getPublicCategories']

  it('公开操作无需鉴权，直接放行', () => {
    for (const a of publicActions) expect(checkAuth({}, '', a)).toBeNull()
  })

  it('未配置 ADMIN_KEY 时管理操作返回配置错误', () => {
    // 本测试文件运行环境未设置 ADMIN_KEY，模块内 ADMIN_KEY 为空
    expect(checkAuth({}, '', 'getProducts')).toEqual({ code: -1, message: '服务未配置 ADMIN_KEY' })
  })

  it('配置了正确密钥时放行、错误密钥拒绝', async () => {
    vi.resetModules()
    process.env.ADMIN_KEY = 'good-key'
    const mod = await import('./index.js')
    vi.resetModules()
    delete process.env.ADMIN_KEY
    expect(mod.checkAuth({}, 'good-key', 'getProducts')).toBeNull()
    expect(mod.checkAuth({}, 'bad-key', 'getProducts')).toEqual({ code: -1, message: '密钥错误' })
  })
})

// ---------- 限流器（真实模块逻辑） ----------
describe('createRateLimiter 限流', () => {
  it('未超限返回 null', () => {
    const limiter = createRateLimiter(60000, 5, '频繁')
    for (let i = 0; i < 5; i++) expect(limiter('1.2.3.4')).toBeNull()
  })
  it('超限返回错误', () => {
    const limiter = createRateLimiter(60000, 5, '频繁')
    for (let i = 0; i < 5; i++) limiter('1.2.3.4')
    expect(limiter('1.2.3.4')).toEqual({ code: -1, message: '频繁' })
  })
  it('不同 IP 互不影响', () => {
    const limiter = createRateLimiter(60000, 2, '频繁')
    limiter('1.1.1.1'); limiter('1.1.1.1'); limiter('1.1.1.1')
    expect(limiter('2.2.2.2')).toBeNull()
  })
})

// ---------- normalizeEvent ----------
describe('normalizeEvent 归一化', () => {
  it('解析 HTTP body 字符串', () => {
    const ev = normalizeEvent({ body: JSON.stringify({ action: 'createOrder', payload: { items: [] } }) })
    expect(ev.action).toBe('createOrder')
  })
  it('直接对象透传', () => {
    const ev = { action: 'getProducts' }
    expect(normalizeEvent(ev)).toEqual(ev)
  })
  it('null 返回空对象', () => expect(normalizeEvent(null)).toEqual({}))
  it('body 非法 JSON 返回空对象', () => expect(normalizeEvent({ body: 'not-json{' })).toEqual({}))
})

// ---------- getClientIp ----------
describe('getClientIp', () => {
  it('优先取 context.source_ip', () => {
    expect(getClientIp({ source_ip: '9.9.9.9' }, {})).toBe('9.9.9.9')
  })
  it('fallback 到 event.requestContext.sourceIp', () => {
    expect(getClientIp({}, { requestContext: { sourceIp: '8.8.8.8' } })).toBe('8.8.8.8')
  })
  it('都没有返回 unknown', () => {
    expect(getClientIp({}, {})).toBe('unknown')
  })
})

// ---------- createSubmissionHandler formData 安全截断（真实模块逻辑） ----------
describe('createSubmissionHandler 表单安全截断', () => {
  function makeDb() {
    const sub = { add: vi.fn().mockResolvedValue({ id: 'sub_1' }) }
    return {
      createCollection: vi.fn().mockResolvedValue({}),
      collection: vi.fn((name) => (name === 'sm_submissions' ? sub : { add: vi.fn(), get: vi.fn() })),
      _sub: sub,
    }
  }
  it('formData 的 key 截断到 50、value 截断到 200', async () => {
    const db = makeDb()
    const res = await createSubmissionHandler(db, {
      serviceId: 's1', serviceName: '维修',
      formData: { [ 'a'.repeat(100) ]: 'b'.repeat(500), normal: 'ok' },
    })
    expect(res.code).toBe(0)
    const saved = db._sub.add.mock.calls[0][0]
    const keys = Object.keys(saved.formData)
    expect(keys[0].length).toBe(50)
    expect(saved.formData[keys[0]].length).toBe(200)
    expect(saved.formData.normal).toBe('ok')
  })
  it('缺少 serviceId/serviceName 报错', async () => {
    const db = makeDb()
    expect((await createSubmissionHandler(db, { formData: {} })).code).toBe(-1)
  })
  it('丢弃注入的顶层字段（_id/status/role），status 由服务端强制为 pending', async () => {
    const db = makeDb()
    const res = await createSubmissionHandler(db, {
      serviceId: 's1', serviceName: '维修',
      _id: 'hack', status: 'done', role: 'admin',
      formData: { a: 'b' },
    })
    expect(res.code).toBe(0)
    const saved = db._sub.add.mock.calls[0][0]
    expect(saved._id).toBeUndefined()
    expect(saved.role).toBeUndefined()
    expect(saved.status).toBe('pending')
  })
})
