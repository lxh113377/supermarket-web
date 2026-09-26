// 对标第十五轮：函数级授权覆盖判据的反向验证。
// 规矩同第十四轮：每条反例只绑一条判据 id；且必须有一条「不红」的对照，
// 否则不知道判红是因为机制还是因为永真。
import { describe, it, expect } from 'vitest'
import { evaluate, loadSources, businessTables, parseBackend } from '../scripts/check-action-authz.mjs'

const BASE = loadSources()
const RED = (v, id) => v.filter((x) => x.id === id && !x.ok).map((x) => x.label)
const withCode = (extraRel, code) => ({
  ...BASE, files: [...BASE.files, { rel: extraRel, code }],
})
// 变异必须自证"真的改到了"：replace 未命中 = 变异没发生 = 判据不红会被误读成"机制没问题"。
// （本轮首跑就是这么被 CRLF 骗过去的：三处 replace 静默空转。）
function patch(src, from, to) {
  const out = src.replace(from, to)
  if (out === src) throw new Error(`变异未落盘: 找不到片段 ${JSON.stringify(from.slice(0, 48))}`)
  return out
}
// 模拟「有人给某个只读 handler 加了写库语句」：同名函数后定义者胜（与 buildWriteGraph 口径一致）
const hijack = (fn, body) => `export async function ${fn}(DB) { ${body} }\n`

describe('对照组', () => {
  it('真仓现状 ⇒ 全绿（且至少 8 条判据，防止"没测所以没红"）', () => {
    const v = evaluate(BASE)
    expect(v.length).toBeGreaterThanOrEqual(8)
    expect(v.filter((x) => !x.ok).map((x) => x.label)).toEqual([])
  })
})

describe('B2 漏登 = 只读密钥可执行', () => {
  it('M1 从 ADMIN_WRITE_ACTIONS 里摘掉 seedReviews ⇒ B2 只点它一名', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc, " 'seedReviews',", '') }
    expect(RED(evaluate(src), 'B2')).toEqual(['B2 业务写 action 全部已登记（漏登=只读密钥可执行）'])
    expect(RED(evaluate(src), 'B3')).toEqual([])
  })

  it('M2 给只读 handler getProducts 加一条 DELETE ⇒ 该 action 立刻算业务写，B2 判红', () => {
    const src = withCode('functions/lib/actions/__synthetic.js', hijack('getProducts', `await qRun(DB, 'DELETE FROM products WHERE _id = ?', ['x'])`))
    const v = evaluate(src)
    expect(RED(v, 'B2')).toHaveLength(1)
    expect(v.find((x) => x.id === 'B2' && !x.ok).detail).toContain('getProducts')
  })

  it('M3 动态表名的写（`DELETE FROM ${t}`）必须也算业务写，不许隐身', () => {
    const src = withCode('functions/lib/actions/__synthetic.js', 'export async function getProducts(DB) {\n  const t = "products"\n  await qRun(DB, `DELETE FROM ${t} WHERE 1=1`, [])\n}\n')
    const v = evaluate(src)
    expect(v.find((x) => x.id === 'B2' && !x.ok)?.detail || '').toContain('getProducts')
  })
})

describe('B3 死项 / B1 零输入', () => {
  it('M4 把一个纯读 action 塞进只读禁用清单 ⇒ B3 判红（清单不许单向膨胀）', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc, "'createProduct', 'updateProduct', 'deleteProduct',", "'createProduct', 'updateProduct', 'deleteProduct', 'getProducts',") }
    expect(RED(evaluate(src), 'B3')).toHaveLength(1)
    expect(evaluate(src).find((x) => x.id === 'B3' && !x.ok).detail).toContain('getProducts')
  })

  it('M5 backendSrc 里没有任何 switch（取数链断了）⇒ B1 判红，绝不记 PASS', () => {
    const v = evaluate({ ...BASE, backendSrc: 'export async function handleAdmin(env) { return { code: -1 } }\nexport async function handlePublic(env) { return { code: -1 } }\n' })
    expect(RED(v, 'B1')).toHaveLength(1)
  })
})

describe('B4/B4b 公开通道具名允许', () => {
  it('M6 把 createOrder 从公开写允许清单里摘掉 ⇒ B4 判红（它确实是 /pub 业务写）', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc, "case 'createOrder':", "case 'createOrderX':") }
    const v = evaluate({ ...src, files: BASE.files }, { pubAllowedList: [{ action: 'addPublicReview', why: 'x'.repeat(20) }, { action: 'createSubmission', why: 'y'.repeat(20) }] })
    expect(RED(v, 'B4')).toHaveLength(1)
  })

  it('M7 允许清单里塞一个早已不是业务写的 action ⇒ B4b 判红（防潜伏死豁免）', () => {
    const v = evaluate(BASE, {
      pubAllowedList: [{ action: 'getPublicProducts', why: '它其实是读'.padEnd(20, ' ') },
        { action: 'createOrder', why: '下单本就是公开写'.padEnd(20, ' ') },
        { action: 'addPublicReview', why: '评价公开写'.padEnd(20, ' ') },
        { action: 'createSubmission', why: '申请公开写'.padEnd(20, ' ') }],
    })
    expect(RED(v, 'B4b')).toHaveLength(1)
  })
})

describe('B8 只读穷举表（默认拒绝的落地面）', () => {
  it('现状：穷举表 15 项、判定式已接线、读写两侧互斥且覆盖全部 31 条路由', () => {
    const v = evaluate(BASE)
    expect(RED(v, 'B8')).toEqual([])
    expect(RED(v, 'B8b')).toEqual([])
    expect(v.find((x) => x.id === 'B8').detail).toContain('15 项')
    expect(v.find((x) => x.id === 'B8').detail).toContain('接线=yes')
  })

  it('M12 把 getProducts 从只读穷举表摘掉（而它也不是写）⇒ B8b 点名"两侧都不在"，即该 action 对只读档默认拒', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc, "'getProducts', 'stalePendingReport'", "'stalePendingReport'") }
    const v = evaluate(src)
    expect(RED(v, 'B8b')).toHaveLength(1)
    expect(v.find((x) => x.id === 'B8b' && !x.ok).detail).toContain('getProducts')
  })

  it('M13 判定式退回"看写清单"（默认允许）⇒ B8 判红：穷举表没接进链路就不算完工', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc,
      "role === 'readonly' && !ADMIN_READ_ACTIONS.has(action)",
      "role === 'readonly' && ADMIN_WRITE_ACTIONS.has(action)") }
    expect(RED(evaluate(src), 'B8')).toHaveLength(1)
  })

  it('M14 一个 action 同时挂在读档与写清单 ⇒ B8b 判红（互斥不许含糊）', () => {
    const src = { ...BASE, backendSrc: patch(BASE.backendSrc, "'login', 'verifyKey',", "'login', 'verifyKey', 'createProduct',") }
    const v = evaluate(src)
    expect(v.find((x) => x.id === 'B8b' && !x.ok).detail).toContain('读写交叉: createProduct')
  })
})

describe('B5/B6 名单对账与副作用表白名单', () => {
  it('M8 PUBLIC_ACTIONS 少一项（路由能到但名单没写）⇒ B5 判红', () => {
    const src = { ...BASE, securitySrc: patch(BASE.securitySrc, "  'getPublicProducts', 'getPublicCategories'", "  'getPublicCategories'") }
    expect(RED(evaluate(src), 'B5')).toHaveLength(1)
  })

  it('M9 副作用表白名单塞一张 schema 里没有的表 ⇒ B6 判红（幽灵豁免）', () => {
    const v = evaluate(BASE, {
      infraTables: [...businessInfra(), { table: 'ghost_table', why: '并不存在，只是想让面变窄'.padEnd(20, ' ') }],
    })
    expect(RED(v, 'B6')).toHaveLength(1)
  })

  it('M10 副作用表白名单条目缺原因 ⇒ B6 判红', () => {
    const v = evaluate(BASE, { infraTables: [{ table: 'rate_limits', why: '短' }, { table: 'security_events', why: '审计流水含 auth_failed，写它与权限档位无关' }, { table: 'ai_calls', why: 'AI 调用观测副作用，不改业务数据' }, { table: 'schema_migrations', why: '迁移账本，不在 action 面内' }] })
    expect(RED(v, 'B6')).toHaveLength(1)
  })
})

function businessInfra() {
  return [
    { table: 'rate_limits', why: '限流计数器，任何鉴权结果都要写'.padEnd(20, ' ') },
    { table: 'security_events', why: '安全审计流水含 auth_failed'.padEnd(20, ' ') },
    { table: 'ai_calls', why: 'AI 调用观测副作用不改业务'.padEnd(20, ' ') },
    { table: 'schema_migrations', why: '迁移账本不在 action 面内'.padEnd(20, ' ') },
  ]
}

describe('B7 新增表默认落进业务面（fail-closed 的那一半）', () => {
  it('M11 schema 新增 promotions 表（未进副作用白名单）且有 handler 写它 ⇒ B2 判红 + 业务表数 +1', () => {
    const schema = BASE.schemaSql + '\nCREATE TABLE IF NOT EXISTS promotions (_id TEXT PRIMARY KEY, pct INTEGER);\n'
    const src = {
      ...withCode('functions/lib/actions/__synthetic.js', hijack('getProducts', `await qRun(DB, 'INSERT INTO promotions (_id, pct) VALUES (?, ?)', ['x', 1])`)),
      schemaSql: schema,
    }
    const v = evaluate(src)
    expect(RED(v, 'B2')).toHaveLength(1)
    expect(v.find((x) => x.id === 'B7').detail).toContain('业务 6')
  })

  it('纯函数面：businessTables 只按白名单分流，不认表名的字面含义', () => {
    const { all, business } = businessTables(BASE.schemaSql)
    expect(all.size).toBe(9)
    expect([...business].sort()).toEqual(['categories', 'orders', 'products', 'reviews', 'submissions'])
    expect(business.has('security_events')).toBe(false)
  })

  it('解析器自证：registered 与路由数从源码解析而来，不是抄的第二份清单', () => {
    const { routes, registered, publicActions } = parseBackend(BASE.backendSrc, BASE.securitySrc)
    expect(routes.admin.size).toBe(31)
    expect(registered).toHaveLength(16)
    expect(publicActions.length).toBe(routes.public.size)
  })
})
