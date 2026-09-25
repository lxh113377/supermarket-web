/**
 * src/api/client.ts 门面直测（防线轮 K1）。
 *
 * 这块是所有云端读写的唯一出口，此前覆盖 9.5%：超时 / 非 JSON / code 缺失 / 网络抛错
 * 四类真实故障路径一条都没断言过。它们决定的是"后端挂了的时候前端说什么话"，
 * 说错或上抛裸异常会直接变成顾客端白屏或管理端无提示。
 * 反例清单见文件末注释，每条都要求"改回朴素实现即变红"。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { loginAdmin, adminCall, publicCall, verifyAdminKey } from '../src/api/client'

type FetchOpts = { signal?: AbortSignal; body?: string }

/** 返回 fetch mock 与 call(n)：第 n 次调用的 [url, 解析后的请求体]，供端点/密钥断言 */
function stubFetch(impl: (opts: FetchOpts) => unknown) {
  const fn = vi.fn(async (_url: string, opts: FetchOpts) => impl(opts))
  vi.stubGlobal('fetch', fn)
  return {
    fn,
    call(n = 0) {
      const [url, opts] = fn.mock.calls[n] as [string, FetchOpts]
      return { url, body: JSON.parse(String(opts.body)) as { action: string; adminKey: string; payload: unknown } }
    },
  }
}

const okJson = (data: unknown) => async () => ({ json: async () => data })
const err = (message: string, name?: string) => Object.assign(new Error(message), name ? { name } : {})

beforeEach(() => {
  sessionStorage.clear()
  vi.stubEnv('VITE_CB_API_BASE', '/web')
  vi.stubEnv('VITE_CB_PUBLIC_API_BASE', '/pub')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('端点选择（resolveBaseUrl 三分支）', () => {
  it('publicCall 走 PUBLIC base，adminCall 走 API base（互不串台）', async () => {
    const f = stubFetch(okJson({ code: 0 }))
    await publicCall('getPublicProducts', {})
    await adminCall('getProducts', {})
    expect(f.call(0).url).toBe('/pub')
    expect(f.call(1).url).toBe('/web')
  })

  it('未配 PUBLIC base 时 publicCall 回退 API base（单端点部署仍能跑）', async () => {
    vi.stubEnv('VITE_CB_PUBLIC_API_BASE', '')
    const f = stubFetch(okJson({ code: 0 }))
    await publicCall('getPublicProducts', {})
    expect(f.call(0).url).toBe('/web')
  })

  it('两个 base 都没配：抛明确错误，且一个请求都不发', async () => {
    vi.stubEnv('VITE_CB_API_BASE', '')
    vi.stubEnv('VITE_CB_PUBLIC_API_BASE', '')
    const f = stubFetch(okJson({ code: 0 }))
    await expect(adminCall('getProducts', {})).rejects.toThrow('未配置接口地址')
    expect(f.fn).not.toHaveBeenCalled()
  })

  it('只配 PUBLIC base 时管理接口同样拒发（adminCall 不回退到 /pub）', async () => {
    vi.stubEnv('VITE_CB_API_BASE', '')
    const f = stubFetch(okJson({ code: 0 }))
    await expect(adminCall('getProducts', {})).rejects.toThrow('未配置接口地址')
    expect(f.fn).not.toHaveBeenCalled()
  })
})

describe('故障路径四类', () => {
  it('超时（AbortError）→ 换成用户可读的「请求超时」', async () => {
    stubFetch(() => { throw err('signal aborted', 'AbortError') })
    await expect(adminCall('getProducts', {})).rejects.toThrow('请求超时，请检查网络后重试')
  })

  it('非 AbortError 的网络抛错原样上抛（不被超时文案改写）', async () => {
    stubFetch(() => { throw err('boom') })
    await expect(adminCall('getProducts', {})).rejects.toThrow('boom')
  })

  it('响应不是 JSON（网关 502 返 HTML）→ 「云函数返回异常」而非 SyntaxError', async () => {
    stubFetch(() => ({ json: async () => { throw new SyntaxError('Unexpected token <') } }))
    await expect(publicCall('getPublicProducts', {})).rejects.toThrow('云函数返回异常')
  })

  it('JSON 里缺 code 字段（跨域被拦/返回体换形）→ 「云函数返回异常」而不是把畸形对象交给业务层', async () => {
    stubFetch(okJson({ message: 'ok' }))
    await expect(publicCall('getPublicProducts', {})).rejects.toThrow('云函数返回异常')
  })

  it('code 为字符串 "0" 也算异常返回（后端只发 number）', async () => {
    stubFetch(okJson({ code: '0', data: [] }))
    await expect(publicCall('getPublicProducts', {})).rejects.toThrow('云函数返回异常')
  })

  it('code:0 正常透传整个响应体', async () => {
    stubFetch(okJson({ code: 0, data: [{ _id: 'p1' }], hasMore: true }))
    await expect(publicCall('getPublicProducts', {})).resolves.toEqual({ code: 0, data: [{ _id: 'p1' }], hasMore: true })
  })
})

describe('超时口径：普通 15s / AI 30s', () => {
  /** 永不 resolve 的 fetch，只观察 signal 何时被 abort —— 判据是"第 20s 还没 abort" */
  function stubNeverSettlingFetch() {
    const state = { aborted: false }
    vi.stubGlobal('fetch', vi.fn((_u: string, opts: FetchOpts) => new Promise((_res, rej) => {
      opts.signal!.addEventListener('abort', () => {
        state.aborted = true
        rej(err('aborted', 'AbortError'))
      })
    })))
    return state
  }

  it('AI action 撑到 20s 仍未被掐（服务端上游 20s，前端必须更宽）', async () => {
    vi.useFakeTimers()
    const state = stubNeverSettlingFetch()
    const p = adminCall('aiAdvice', {})
    const swallowed = p.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(state.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(10_500)
    expect(state.aborted).toBe(true)
    await expect(p).rejects.toThrow('请求超时')
    await swallowed
  })

  it('普通 action 15s 即超时（不设上限会让看板转圈到天荒地老）', async () => {
    vi.useFakeTimers()
    const state = stubNeverSettlingFetch()
    const p = adminCall('getProducts', {}).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(15_500)
    expect(state.aborted).toBe(true)
    await p
  })

  it('显式传 timeoutMs 覆盖两档默认值', async () => {
    vi.useFakeTimers()
    const state = stubNeverSettlingFetch()
    const p = adminCall('aiChat', {}, 1_000).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    expect(state.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(700)
    expect(state.aborted).toBe(true)
    await p
  })
})

describe('会话密钥存取（adminKey 只来自 sessionStorage）', () => {
  it('已缓存密钥则每次管理调用都带上', async () => {
    sessionStorage.setItem('sm_admin_key', 'k1')
    const f = stubFetch(okJson({ code: 0 }))
    await adminCall('getProducts', {})
    expect(f.call(0).body).toEqual({ action: 'getProducts', adminKey: 'k1', payload: {} })
  })

  it('sessionStorage 抛错（隐私模式）时退化为空密钥而不是崩溃', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    const f = stubFetch(okJson({ code: 0 }))
    await expect(adminCall('getProducts', {})).resolves.toEqual({ code: 0 })
    expect(f.call(0).body.adminKey).toBe('')
    spy.mockRestore()
  })

  it('publicCall 永远不带密钥', async () => {
    sessionStorage.setItem('sm_admin_key', 'k1')
    const f = stubFetch(okJson({ code: 0 }))
    await publicCall('getPublicProducts', { a: 1 })
    expect(f.call(0).body.adminKey).toBe('')
    expect(f.call(0).body.payload).toEqual({ a: 1 })
  })

  it('payload 传 null 时兜底成空对象（后端按 object 解析）', async () => {
    const f = stubFetch(okJson({ code: 0 }))
    await adminCall('getProducts', null as never)
    expect(f.call(0).body.payload).toEqual({})
  })
})

describe('loginAdmin', () => {
  it('code 0 → true 且把密钥写进会话（刷新后仍登录靠它）', async () => {
    stubFetch(okJson({ code: 0, data: { role: 'admin' } }))
    await expect(loginAdmin('good')).resolves.toBe(true)
    expect(sessionStorage.getItem('sm_admin_key')).toBe('good')
  })

  it('code≠0 且后端给了 message → 抛真实原因（"服务未配置 ADMIN_KEY" 之类必须露出来）', async () => {
    stubFetch(okJson({ code: -1, message: '服务未配置 ADMIN_KEY' }))
    await expect(loginAdmin('x')).rejects.toThrow('服务未配置 ADMIN_KEY')
    expect(sessionStorage.getItem('sm_admin_key')).toBeNull()
  })

  it('code≠0 且无 message → 兜底「密钥错误」', async () => {
    stubFetch(okJson({ code: -1 }))
    await expect(loginAdmin('x')).rejects.toThrow('密钥错误')
  })

  it('setItem 抛错也不影响登录结果（只是不保持登录态）', async () => {
    stubFetch(okJson({ code: 0 }))
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    await expect(loginAdmin('good')).resolves.toBe(true)
    spy.mockRestore()
  })

  it('传输层抛错原样上抛（登录失败要显示原因，不能静默 false）', async () => {
    stubFetch(() => { throw err('boom') })
    await expect(loginAdmin('x')).rejects.toThrow('boom')
  })
})

describe('verifyAdminKey（刷新后维持登录态的判定）', () => {
  it('code 0 → true', async () => {
    stubFetch(okJson({ code: 0 }))
    await expect(verifyAdminKey('k')).resolves.toBe(true)
  })

  it('code≠0 → false', async () => {
    stubFetch(okJson({ code: -1, message: '密钥错误' }))
    await expect(verifyAdminKey('k')).resolves.toBe(false)
  })

  it('网络抛错 → false 而非上抛（校验失败该退回登录框，不该白屏）', async () => {
    stubFetch(() => { throw err('offline') })
    await expect(verifyAdminKey('k')).resolves.toBe(false)
  })

  it('走的确实是 verifyKey 这个 action 且带上待验密钥', async () => {
    const f = stubFetch(okJson({ code: 0 }))
    await verifyAdminKey('kk')
    expect(f.call(0).body).toEqual({ action: 'verifyKey', adminKey: 'kk', payload: {} })
  })
})

/*
 * 反例（每条改回朴素实现后，本文件对应用例必须变红；已在本轮逐条实跑）：
 * 1 resolveBaseUrl 去掉 PUBLIC 分支           → 「publicCall 走 PUBLIC base」红
 * 2 去掉 `if (!url) throw` 兜底域名           → 两条「未配置接口地址」红
 * 3 去掉 e.name==='AbortError' 映射           → 「超时」用例错误串变 aborted
 * 4 去掉 res.json().catch(()=>({}))           → 「非 JSON」用例抛 SyntaxError
 * 5 去掉 typeof data.code!=='number' 判定     → 「缺 code」「code:"0"」两用例红
 * 6 AI_TIMEOUT_MS 改回 15000                  → 「AI 撑到 20s」用例红
 * 7 去掉 getCachedKey 的 try/catch            → 「隐私模式退化」用例抛 SecurityError
 * 8 loginAdmin 硬编码只抛「密钥错误」         → 「抛真实原因」用例红
 * 9 登录失败仍写 sessionStorage               → 「不写密钥」断言红
 * 10 verifyAdminKey 不 catch                  → 「网络抛错→false」用例红
 */
