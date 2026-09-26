/**
 * 新订单外部通知（webhook）单测 —— 三条不变量各配正反两侧（对标第十轮：litemall 未配即 no-op、
 * saleor 投递失败与订单解耦、Cloudflare waitUntil 保活）。
 * 重点不是"能发出去"，而是"发不出去时下单必须还成功"。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  webhookTarget, newOrderWebhookBody, deliverNewOrder, maybeNotifyNewOrder,
} from '../functions/lib/notify.js'
import { handlePublic } from '../functions/lib/backend.js'
import { fakeDb, fakeKv } from './helpers/fakeDb'

const ok200 = { status: 200 }

describe('webhookTarget：任何"不可用"形态统一收敛为 null（no-op 的唯一开关）', () => {
  it('未配置 / 空串 / 纯空白 → null', () => {
    expect(webhookTarget({})).toBeNull()
    expect(webhookTarget({ ORDER_WEBHOOK_URL: '' })).toBeNull()
    expect(webhookTarget({ ORDER_WEBHOOK_URL: '   ' })).toBeNull()
    expect(webhookTarget(undefined)).toBeNull()
  })
  it('非法 URL 不抛错，视同未配置', () => {
    expect(() => webhookTarget({ ORDER_WEBHOOK_URL: 'not a url' })).not.toThrow()
    expect(webhookTarget({ ORDER_WEBHOOK_URL: 'not a url' })).toBeNull()
  })
  it('只认 http/https：file:/data: 一律拒（防把订单数据交给本地处理器）', () => {
    expect(webhookTarget({ ORDER_WEBHOOK_URL: 'file:///etc/passwd' })).toBeNull()
    expect(webhookTarget({ ORDER_WEBHOOK_URL: 'data:text/plain,hi' })).toBeNull()
    expect(webhookTarget({ ORDER_WEBHOOK_URL: 'https://hook.example/x' })?.href).toBe('https://hook.example/x')
  })
})

describe('载荷字段白名单（默认拒绝而非默认外发）', () => {
  it('只出 6 个履约字段，微信号/备注/付款截图一律不外发', () => {
    const body = newOrderWebhookBody({
      id: 'o_1', roomNumber: 'A101', totalAmount: 12.5, status: 'pending',
      items: [{ quantity: 1 }, { quantity: 2 }],
      wechat: 'wx_secret_id', remark: '放门口', paymentScreenshot: 'data:image/png;base64,AAAA',
    })
    expect(Object.keys(body).sort()).toEqual(
      ['event', 'itemCount', 'orderId', 'roomNumber', 'status', 'totalAmount'].sort(),
    )
    expect(body.itemCount).toBe(2)
    const json = JSON.stringify(body)
    for (const leak of ['wx_secret_id', '放门口', 'base64', 'paymentScreenshot']) {
      expect(json).not.toContain(leak)
    }
  })
})

describe('deliverNewOrder：全分支返回结论，永不抛错', () => {
  it('未配置 → fetch 一次都不调用（no-op 且无重试配额消耗）', async () => {
    const spy = vi.fn()
    const r = await deliverNewOrder({}, { id: 'o_1' }, { fetchImpl: spy })
    expect(r).toEqual({ delivered: false, reason: 'not_configured' })
    expect(spy).not.toHaveBeenCalled()
  })
  it('配置好且端点 200 → delivered，POST + JSON 体', async () => {
    const spy = vi.fn().mockResolvedValue(ok200)
    const r = await deliverNewOrder({ ORDER_WEBHOOK_URL: 'https://hook.example/x' },
      { id: 'o_2', roomNumber: 'B202', totalAmount: 8, items: [{}], status: 'pending' },
      { fetchImpl: spy })
    expect(r.delivered).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://hook.example/x')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).orderId).toBe('o_2')
  })
  it('端点 500 → delivered:false 且不抛（saleor 式"投递是记录不是返回值"）', async () => {
    const spy = vi.fn().mockResolvedValue({ status: 500 })
    await expect(deliverNewOrder({ ORDER_WEBHOOK_URL: 'https://hook.example/x' }, { id: 'o_3' },
      { fetchImpl: spy })).resolves.toEqual({ delivered: false, reason: 'http_500' })
  })
  it('网络抛错 / 超时都被吞成结论', async () => {
    const boom = vi.fn().mockRejectedValue(new TypeError('network down'))
    expect((await deliverNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' }, { id: 'o_4' },
      { fetchImpl: boom })).reason).toBe('fetch_failed')
    const to = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'))
    expect((await deliverNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' }, { id: 'o_5' },
      { fetchImpl: to })).reason).toBe('timeout')
  })
  it('没有订单号时不发请求（防空载荷打到第三方）', async () => {
    const spy = vi.fn()
    expect((await deliverNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' }, null,
      { fetchImpl: spy })).reason).toBe('no_order')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('maybeNotifyNewOrder：三个"不该通知"的出口 + 一个该通知的出口', () => {
  it('下单失败（code≠0）→ 不通知', () => {
    expect(maybeNotifyNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' },
      { code: -1, message: '库存不足' }, {}, () => {}).scheduled).toBe(false)
  })
  it('幂等命中（deduplicated）→ 不通知：重试同一张单不该重复提醒', () => {
    const r = maybeNotifyNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' },
      { code: 0, data: { id: 'o_6', totalAmount: 3, deduplicated: true } }, { items: [] }, () => {})
    expect(r).toEqual({ scheduled: false, reason: 'not_a_new_order' })
  })
  it('未配 webhook → 连 promise 都不创建（无副作用）', () => {
    const spy = vi.fn()
    const r = maybeNotifyNewOrder({}, { code: 0, data: { id: 'o_7' } }, { items: [] }, spy)
    expect(r.scheduled).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
  it('新单 + 有 waitUntil → 挂起保活并把结论回传', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ok200)
    const held = []
    const r = maybeNotifyNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' },
      { code: 0, data: { id: 'o_8', totalAmount: 9.9 } },
      { roomNumber: ' C303 ', items: [{ quantity: 1 }] }, (p) => held.push(p))
    expect(r).toEqual({ scheduled: true, reason: 'wait_until' })
    expect(held).toHaveLength(1)
    expect(await held[0]).toEqual({ delivered: true, reason: 'http_200' })
  })
  it('载荷里的 roomNumber 走与落库同样的 trim', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(ok200)
    const held = []
    maybeNotifyNewOrder({ ORDER_WEBHOOK_URL: 'https://h/x' },
      { code: 0, data: { id: 'o_9' } }, { roomNumber: '  D404  ', items: [] }, (p) => held.push(p))
    expect((await held[0]) && JSON.stringify(newOrderWebhookBody({ roomNumber: 'D404' })))
      .toContain('D404')
  })
})

describe('主链路不变量：端点挂了也不影响下单（真跑 handlePublic）', () => {
  afterEach(() => { delete globalThis.__unhandled })

  const envWith = (webhook) => {
    const products = [{ _id: 'p_n', name: '通知测试汽水', spec: '500ml', price: 3, enabled: 1, subcategories: [], stock: 9 }]
    const env = { DB: fakeDb({ products }), RATE_KV: fakeKv(), ADMIN_KEY: 'k', ADMIN_READONLY_KEY: 'r' }
    if (webhook) env.ORDER_WEBHOOK_URL = webhook
    return env
  }
  const payload = { roomNumber: 'E505', items: [{ productId: 'p_n', quantity: 1 }], wechat: 'wx' }

  it('端点永久失败：下单仍 code 0，且订单号可用', async () => {
    const unhandled = []
    globalThis.__unhandled = unhandled
    const onUnhandled = (e) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('endpoint dead'))
    const env = envWith('https://hook.example/order')
    const r = await handlePublic(env, 'createOrder', payload, null, () => {})
    expect(r.code).toBe(0)
    expect(typeof r.data.id).toBe('string')
    await new Promise((res) => setTimeout(res, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })
  it('对照组：不配 webhook 时同样下单成功（证明新增代码零回归）', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('不该被调用'))
    const r = await handlePublic(envWith(null), 'createOrder', payload, null, null)
    expect(r.code).toBe(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
