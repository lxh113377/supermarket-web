// 第十八轮夹具：错误语义判据的双向变异审计。
// 口径：每条新判据必须"既防漏报也防误报"—— 正例证明不误伤，反例证明真会红（negative control first）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  run, scanFailExits, parseRegistry, parseMirror, diffRegistry, diffMirror,
  scanRetryAfter, scanSilentFallback, KINDS, ALLOWED_STATUS,
} from '../scripts/check-error-semantics.mjs'
import { classifyFailure, isFallbackSafe, SERVER_ERROR_KIND, ERROR_KINDS, OrderRejectedError } from '../src/api/error-codes'
import { ERRORS, fail, apiResponse } from '../functions/lib/errors.js'

const REG = 'docs/error-codes.md'
const DECLARED = Object.keys(ERRORS)

// 真 createOrder 的形态：函数开头一句"非云端直接落本地"，catch 里先早退再兜底。
const GOOD_ORDER_SRC = `import { OrderRejectedError } from '../api/error-codes'
export async function createOrder(order) {
  if (!IS_CLOUD) {
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
  try {
    const result = await publicCall('createOrder', clean)
    if (result.code !== 0) {
      if (!isFallbackSafe(result)) throw new OrderRejectedError(result.errorCode, 'state', 'x')
      throw new Error('创建订单失败')
    }
    return { id: result.data.id }
  } catch (e) {
    if (e instanceof OrderRejectedError) throw e
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
}`

describe('E1 枚举器：区分裸信封与 fail() 出口', () => {
  it('反例：裸 { code: -1 } 被点名', () => {
    const hits = scanFailExits("  return { code: -1, message: 'boom' }", 'f.js')
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('bare')
  })
  it('正例：fail() 出口记成 coded 并抽出码名（同一行两个出口都抽到）', () => {
    const hits = scanFailExits("  if (a) return fail('auth_failed', 'x'); if (b) return fail('rate_limited', 'y')", 'f.js')
    expect(hits.map((h) => h.kind)).toEqual(['coded', 'coded'])
    expect(hits.map((h) => h.code)).toEqual(['auth_failed', 'rate_limited'])
  })
  it('边界：非失败面（code: 0 / 其它数字）不误伤', () => {
    expect(scanFailExits('  return { code: 0, data: 1 }', 'f.js')).toHaveLength(0)
    expect(scanFailExits('  const x = { code: -2 }', 'f.js')).toHaveLength(0)
  })
})

describe('E3 登记册：解析与双向差分', () => {
  const rows = parseRegistry(readFileSync(REG, 'utf8'))

  // 分母 33 → 35：第三十七轮新增 payload_too_large 与 quantity_exceeds_limit（两个都要具名登记，不接受复用别人的码）
  // 分母 35 → 38：第五十六轮 E7 库存域新增 invalid_delta / invalid_kind / stock_untracked
  // 分母 38 → 41：2026-10-07 新增打印域 print_storage_unavailable / print_file_too_large / print_file_type_denied
    it('正向：真仓登记册零差异，分母由表自身给出（41 行）', () => {
    expect(rows.size).toBe(41)
    expect(diffRegistry(DECLARED, ERRORS, rows)).toEqual({ miss: [], extra: [], mismatch: [], stub: [] })
  })
  it('反例 a：文档少一行 ⇒ miss 点名', () => {
    const r = new Map(rows); r.delete('stock_insufficient')
    expect(diffRegistry(DECLARED, ERRORS, r).miss).toEqual(['stock_insufficient'])
  })
  it('反例 b：文档多一行代码里不存在的码 ⇒ extra 点名（只加不减同样判红）', () => {
    const r = new Map(rows); r.set('ghost_code', { kind: 'input', status: 400, retryable: false, raw: '| ghost_code |' })
    expect(diffRegistry(DECLARED, ERRORS, r).extra).toEqual(['ghost_code'])
  })
  it('反例 c：HTTP 抄错一个数字 ⇒ mismatch（不是"差一点放过"）', () => {
    const r = new Map(rows)
    r.set('stock_insufficient', { kind: 'state', status: 400, retryable: false, raw: '' })
    expect(diffRegistry(DECLARED, ERRORS, r).mismatch.join()).toContain('stock_insufficient HTTP 文档=400')
  })
  it('反例 d：kind 写错 ⇒ mismatch；kind 非法 ⇒ 独立点名', () => {
    const wrong = new Map(rows); wrong.set('rate_limited', { kind: 'state', status: 429, retryable: true, raw: '' })
    expect(diffRegistry(DECLARED, ERRORS, wrong).mismatch.join()).toContain('rate_limited kind')
    const illegal = new Map(rows); illegal.set('rate_limited', { kind: 'oops', status: 429, retryable: true, raw: '' })
    expect(diffRegistry(DECLARED, ERRORS, illegal).mismatch.join()).toContain('非法')
  })
  it('反例 e：TODO 占位行 ⇒ stub 非空（自动生成不等于已论证）', () => {
    const r = new Map(rows); r.set('auth_failed', { kind: 'auth', status: 401, retryable: false, raw: '| auth_failed | TODO |' })
    expect(diffRegistry(DECLARED, ERRORS, r).stub).toHaveLength(1)
  })
  it('边界：表头/分隔行不算数据行；只认 4 列齐备', () => {
    const only = parseRegistry('| errorCode | kind | HTTP | retryable | 触发条件 | 处置 |\n|---|---|---|---|---|---|\n| a_b | input | 400 | false | x | y |\n| 短行 | 短 |\n')
    expect([...only.keys()]).toEqual(['a_b'])
  })
  it('档位表自身合法：kind 恰 5 类，HTTP 全是 4xx/5xx（200 不在允许档位内）', () => {
    expect([...KINDS]).toEqual(['input', 'state', 'auth', 'quota', 'platform'])
    expect(ALLOWED_STATUS.has(200)).toBe(false)
    expect([...ALLOWED_STATUS].every((s) => s >= 400 && s <= 599)).toBe(true)
    expect(DECLARED.every((c) => ALLOWED_STATUS.has(ERRORS[c].status))).toBe(true)
    expect(DECLARED.every((c) => KINDS.has(ERRORS[c].kind))).toBe(true)
  })
})

describe('E4 前端镜像：解析与差分', () => {
  it('正向：真镜像零差异', () => {
    const m = parseMirror(readFileSync('src/api/error-codes.ts', 'utf8'))
    expect(diffMirror(DECLARED, ERRORS, m)).toEqual({ unparseable: false, miss: [], extra: [], kindDiff: [] })
  })
  it('反例：前端 kind 抄错 ⇒ kindDiff 点名', () => {
    const src = readFileSync('src/api/error-codes.ts', 'utf8').replace("stock_insufficient: 'state'", "stock_insufficient: 'input'")
    expect(src).not.toContain("stock_insufficient: 'state'")
    expect(diffMirror(DECLARED, ERRORS, parseMirror(src)).kindDiff).toEqual(['stock_insufficient=input'])
  })
  it('反例：前端漏一个码 ⇒ miss 点名（镜像少一半正是本轮要防的）', () => {
    const src = readFileSync('src/api/error-codes.ts', 'utf8').replace("  stock_insufficient: 'state',\n", '')
    expect(diffMirror(DECLARED, ERRORS, parseMirror(src)).miss).toContain('stock_insufficient')
  })
  it('边界：镜像块被改名 ⇒ unparseable（判红而不是"空集合=通过"）', () => {
    expect(parseMirror("export const RENAMED_KIND: any = { a: 'input' }")).toBeNull()
    expect(diffMirror(DECLARED, ERRORS, null).unparseable).toBe(true)
  })
})

describe('E5 静默兜底面：本轮 P0 的永久判据（四向变异）', () => {
  it('正例：真结构 0 problems', () => {
    expect(scanSilentFallback(GOOD_ORDER_SRC)).toEqual([])
  })
  it('反例 a：删掉 catch 早退 ⇒ 红（业务拒绝重新被兜底吞掉）', () => {
    const s = GOOD_ORDER_SRC.replace('    if (e instanceof OrderRejectedError) throw e\n', '')
    expect(s).not.toBe(GOOD_ORDER_SRC)
    expect(scanSilentFallback(s).join()).toContain('早退')
  })
  it('反例 b：早退写在兜底之后 ⇒ 红（顺序错=等于没防）', () => {
    const swapped = GOOD_ORDER_SRC.replace(
      "    if (e instanceof OrderRejectedError) throw e\n    return { id: addLocalOrder(clean)._id, localFallback: true }",
      "    return { id: addLocalOrder(clean)._id, localFallback: true }\n    if (e instanceof OrderRejectedError) throw e")
    expect(swapped).not.toBe(GOOD_ORDER_SRC)
    expect(scanSilentFallback(swapped).join()).toContain('顺序错')
  })
  it('反例 c：分流改成判 message 字符串 ⇒ 红（单点故障：只动 message 判据这一处）', () => {
    const s = GOOD_ORDER_SRC.replace("      throw new Error('创建订单失败')", "      if (result.message === '库存不足') return null")
    expect(s).toContain('isFallbackSafe')
    expect(scanSilentFallback(s).join()).toContain('message 字符串分支')
  })
  it('反例 d：函数改名 ⇒ 判据不静默失效，而是报"没解析到"', () => {
    expect(scanSilentFallback(GOOD_ORDER_SRC.replace('createOrder', 'submitOrder'))[0]).toContain('没解析到 createOrder')
  })
  it('反例 e：丢掉 isFallbackSafe ⇒ 红（不是只靠早退兜住）', () => {
    const s = GOOD_ORDER_SRC.replace('      if (!isFallbackSafe(result)) throw new OrderRejectedError(result.errorCode, \'state\', \'x\')\n', '')
    expect(scanSilentFallback(s).join()).toContain('isFallbackSafe')
  })
  it('接线：真仓 src/db/orders.ts 过本判据', () => {
    expect(scanSilentFallback(readFileSync('src/db/orders.ts', 'utf8'))).toEqual([])
  })
})

describe('E6 Retry-After 来源', () => {
  it('反例：429 出口漏 retryAfterMs ⇒ 点名', () => {
    expect(scanRetryAfter("  if (x) return fail('rate_limited', '操作过于频繁')")).toHaveLength(1)
  })
  it('正例：带了就不报；非 429 出口不误伤', () => {
    expect(scanRetryAfter("  return fail('rate_limited', 'x', { retryAfterMs: 1000 })")).toHaveLength(0)
    expect(scanRetryAfter("  return fail('auth_failed', 'x')")).toHaveLength(0)
  })
})

describe('分流行为真值表（前端侧：本轮缺陷的行为级证据）', () => {
  it('业务拒绝一律禁兜底 —— 含本轮那一条 stock_insufficient', () => {
    for (const code of ['stock_insufficient', 'product_disabled', 'invalid_quantity', 'auth_failed',
      'rate_limited', 'concurrent_update', 'invalid_transition', 'image_too_large']) {
      expect(isFallbackSafe({ errorCode: code, kind: SERVER_ERROR_KIND[code] }), code).toBe(false)
    }
  })
  it('只有 platform 允许兜底（本轮唯一保留的下单兜底出口）', () => {
    for (const code of ['db_unbound', 'internal_error', 'order_create_failed']) {
      expect(ERRORS[code].kind).toBe('platform')
      expect(isFallbackSafe({ errorCode: code, kind: 'platform' }), code).toBe(true)
    }
  })
  it('保守方向：后端未升级/旧包无 errorCode ⇒ transport ⇒ 仍允许兜底（未部署前不打断现网下单）', () => {
    expect(classifyFailure({})).toBe('transport')
    expect(classifyFailure(null)).toBe('transport')
    expect(classifyFailure({ errorCode: 'not_in_table' })).toBe('transport')
    expect(isFallbackSafe({})).toBe(true)
  })
  it('只给 errorCode 不给 kind 时按码表反查（镜像独立可用）', () => {
    expect(classifyFailure({ errorCode: 'stock_insufficient' })).toBe('state')
    expect(classifyFailure({ kind: '乱写的值', errorCode: 'rate_limited' })).toBe('quota')
  })
  it('兜底边界集 = {platform, transport}，四类业务失败全禁（两侧都钉：收紧会打断现网、放宽会重现丢单）', () => {
    const kinds = ['input', 'state', 'auth', 'quota', 'platform', 'transport']
    const allowed = kinds.filter((k) => k === 'platform' || k === 'transport')
    const forbidden = kinds.filter((k) => k !== 'platform' && k !== 'transport')
    expect(allowed.length).toBe(2)
    for (const k of allowed) expect(isFallbackSafe({ errorCode: 'x', kind: k }), k).toBe(true)
    for (const k of forbidden) expect(isFallbackSafe({ errorCode: 'x', kind: k }), k).toBe(false)
    // 对偶：全码表里"允许兜底"的码恰好只有 platform 那几个（有人偷偷给 state 放行会红）。
    // 3 → 4：print_storage_unavailable（2026-10-07）也是 platform —— 它是**部署态**问题
    // （R2 桶没建/没绑），跟 db_unbound 同族，不该让顾客背锅。
    const fallbackCodes = DECLARED.filter((c) => isFallbackSafe({ errorCode: c, kind: ERRORS[c].kind }))
    expect(fallbackCodes).toEqual(['print_storage_unavailable', 'db_unbound', 'internal_error', 'order_create_failed'])
  })
  it('OrderRejectedError 保真：可被上层 instanceof，且 kind 落在合法档位', () => {
    const e = new OrderRejectedError('stock_insufficient', 'state', '库存不足: 可乐')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('OrderRejectedError')
    expect(ERROR_KINDS).toContain(e.kind)
    expect(e.message).toBe('库存不足: 可乐')
  })
})

describe('信封与状态映射（后端真跑）', () => {
  it('code 恒 -1 是兼容性红线，不是巧合', () => {
    expect(fail('auth_failed', 'x').code).toBe(-1)
    expect(fail('stock_insufficient', 'x').code).toBe(-1)
  })
  it('未登记码降级成 platform/500 且**不抛**（抛会让鉴权链整条不可用）', () => {
    const r = fail('typo_code', 'x')
    expect(r.errorCode).toBe('internal_error')
    expect(r.kind).toBe('platform')
    expect(() => fail('typo_code', 'x')).not.toThrow()
  })
  it('成功仍 200；state→409；quota→429 带 Retry-After；auth→401；体积→413', () => {
    const st = (r) => apiResponse(r, {}).status
    expect(st({ code: 0 })).toBe(200)
    expect(st(fail('stock_insufficient', 'x'))).toBe(409)
    expect(st(fail('auth_failed', 'x'))).toBe(401)
    expect(st(fail('image_too_large', 'x'))).toBe(413)
    const res = apiResponse(fail('rate_limited', 'x', { retryAfterMs: 1500 }), { 'X-Cors': '1' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
    expect(res.headers.get('X-Cors')).toBe('1')
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })
  it('非 429 不塞 Retry-After（防把建议头当成万能字段）', () => {
    expect(apiResponse(fail('auth_failed', 'x'), {}).headers.get('Retry-After')).toBeNull()
  })
  it('Retry-After 下界为 1 秒（0 等于告诉客户端可以立刻再打）', () => {
    expect(apiResponse(fail('rate_limited', 'x', { retryAfterMs: 0 }), {}).headers.get('Retry-After')).toBe('1')
    expect(apiResponse(fail('rate_limited', 'x'), {}).headers.get('Retry-After')).toBe('1')
  })
})

describe('接线：真仓跑完整判据链', () => {
  it('E1~E8 九项全过（纯函数过了不算数，判据必须在真仓上有效）', async () => {
    const { results } = await run()
    const failed = results.map((r) => (r.ok ? null : `${r.id} ${r.name}: ${r.detail}`)).filter(Boolean)
    expect(failed).toEqual([])
    expect(results.map((r) => r.id)).toEqual(['E1', 'E2', 'E3', 'E3b', 'E4', 'E5', 'E6', 'E7', 'E8'])
  })
})
