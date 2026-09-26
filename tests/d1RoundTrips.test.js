// 对标第十四轮：D1 往返判据的反向验证（mutation audit）。
// 规矩（第十/十三轮立）：判据必须能被逐条打红，且每条反例只绑一条判据 id——
// 「跑一遍没红」不等于「它有牙齿」。这里既打纯函数 evaluate，也打真 AST 扫描器与真 mock。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  evaluate, findLoopsInSource, measure, REGISTER, EXEMPT, STATEMENT_BUDGET_EXEMPT,
  STATEMENT_BUDGET_FREE,
} from '../scripts/check-d1-roundtrips.mjs'
import { openSqlite, createMeteredD1 } from '../scripts/lib/metered-d1.mjs'
import { qBatch } from '../functions/lib/db.js'

const RED_IDS = (verdicts, id) => verdicts.filter((v) => v.id === id && !v.ok).map((v) => v.label)
// 「干净基线」：与本轮实测同形（createOrder 往返常数/语句线性；batchUpdate 两条尺都线性但已具名豁免；
// batchDelete 常数；seedReviews 定形）。纯函数变异测试以此为底，逐条打破。
const SHAPE = {
  'P:createOrder': { st: (n) => 5 + n, rt: () => 6 },
  'A:batchUpdateProducts': { st: (n) => 1 + n, rt: (n) => 1 + n },
  'A:batchDeleteProducts': { st: () => 3, rt: () => 3 },
  'A:seedReviews': { st: () => 22, rt: () => 3 },
}
const cleanRows = () => REGISTER.map((e) => {
  const shape = SHAPE[e.name]
  const point = e.at.map((n) => ({ n, statements: shape.st(n), roundTrips: shape.rt(n) }))
  const span = e.at[1] - e.at[0]
  const last = point[point.length - 1]
  return {
    ...e, point, last,
    rtSlope: span === 0 ? null : (point[1].roundTrips - point[0].roundTrips) / span,
    stSlope: span === 0 ? null : (point[1].statements - point[0].statements) / span,
    maxStatements: Math.max(...point.map((p) => p.statements)),
    maxRoundTrips: last.roundTrips,
  }
})
const cleanHits = () => EXEMPT.map((e) => ({ site: e.site, via: 'qRun', line: 1 }))

describe('A1 零输入不判绿', () => {
  it('rows 为空 ⇒ A1 判红（零输入不得记 PASS）', () => {
    const v = evaluate({ rows: [], hits: [], sourcesCount: 3 })
    expect(RED_IDS(v, 'A1')).toHaveLength(1)
  })
  it('对照组：全量在册且无变异 ⇒ 零红（否则下面每条都可能是永动机）', () => {
    const v = evaluate({ rows: cleanRows(), hits: cleanHits(), sourcesCount: 17 })
    expect(v.filter((x) => !x.ok).map((x) => x.label)).toEqual([])
  })
})

describe('A2/A3 变异各绑一条判据', () => {
  it('M1 createOrder 退回逐条循环（往返斜率 1）⇒ 只 A2 红', () => {
    const rows = cleanRows().map((r) => (r.name === 'P:createOrder' ? { ...r, rtSlope: 1 } : r))
    const v = evaluate({ rows, hits: cleanHits(), sourcesCount: 17 })
    expect(RED_IDS(v, 'A2')).toEqual(['A2 往返不随规模增长 P:createOrder'])
    expect(v.some((x) => x.id === 'A3' && !x.ok)).toBe(false)
  })

  it('M2 最大规模语句数越预算：无具名登记 ⇒ A3 红；补上具名登记 ⇒ A3 绿（双向验，证明翻转靠豁免不靠数字）', () => {
    const rows = cleanRows().map((r) => (r.name === 'P:createOrder' ? { ...r, maxStatements: 51 } : r))
    const v = evaluate({ rows, hits: cleanHits(), sourcesCount: 17 })
    expect(RED_IDS(v, 'A3')).toEqual(['A3 语句预算对账 P:createOrder'])
    const withExempt = evaluate({ rows, hits: cleanHits(), sourcesCount: 17 }, {
      budgetExempt: [...STATEMENT_BUDGET_EXEMPT, { action: 'P:createOrder', why: '对照组用登记项'.padEnd(30, '明') }],
    })
    expect(withExempt.some((x) => x.id === 'A3' && !x.ok)).toBe(false)
  })

  it('M3 预算豁免指向不在册的 action ⇒ A3b 红（豁免不能凭空造对象）', () => {
    const v = evaluate(
      { rows: cleanRows(), hits: cleanHits(), sourcesCount: 17 },
      { budgetExempt: [{ action: 'A:GhostAction', why: 'x'.repeat(30) }] },
    )
    expect(RED_IDS(v, 'A3b')).toHaveLength(1)
  })

  it('M4 定形项只登记不测（无 rtMax）⇒ A2 红，堵住 fixedShape 变免检通道', () => {
    const rows = cleanRows().map((r) => (r.fixedShape ? { ...r, rtMax: undefined } : r))
    const v = evaluate({ rows, hits: cleanHits(), sourcesCount: 17 })
    expect(RED_IDS(v, 'A2')).toEqual(['A2 定形项须声明上界 A:seedReviews'])
  })

  it('M5 定形项往返超上界 ⇒ A2b 红', () => {
    const rows = cleanRows().map((r) => (r.fixedShape ? { ...r, maxRoundTrips: r.rtMax + 8 } : r))
    const v = evaluate({ rows, hits: cleanHits(), sourcesCount: 17 })
    expect(RED_IDS(v, 'A2b')).toEqual(['A2b 定形往返上界 A:seedReviews'])
  })
})

describe('A7 扫描面与豁免清单对账', () => {
  it('M6 新增未登记的循环内 DB 调用 ⇒ A7 红', () => {
    const v = evaluate({ rows: cleanRows(), hits: [...cleanHits(), { site: 'x.js#newFn', via: 'qRun', line: 9 }], sourcesCount: 17 })
    expect(RED_IDS(v, 'A7')).toEqual(['A7 循环内 DB 调用已具名豁免 x.js#newFn'])
  })

  it('M7 代码已改好但豁免清单还留着 ⇒ A7b 红（防潜伏死豁免）', () => {
    const v = evaluate({ rows: cleanRows(), hits: cleanHits().slice(1), sourcesCount: 17 })
    expect(RED_IDS(v, 'A7b')).toHaveLength(1)
  })

  it('M8 扫描面为空 ⇒ A6 红；M9 豁免缺原因 ⇒ A6b 红', () => {
    expect(RED_IDS(evaluate({ rows: cleanRows(), hits: cleanHits(), sourcesCount: 0 }), 'A6')).toHaveLength(1)
    const mangled = [{ ...EXEMPT[0], why: '短' }, ...EXEMPT.slice(1)]
    expect(evaluate({ rows: cleanRows(), hits: cleanHits(), sourcesCount: 17 }, { exempt: mangled })
      .some((x) => x.id === 'A6b' && !x.ok)).toBe(true)
  })
})

describe('A7 枚举器：真 AST 而非文本匹配（假阳性与假阴性双向验）', () => {
  const F = 'export async function outer(DB) {\n'
  it('for-of 体内 qRun ⇒ 归属 outer，不误报为变量名', () => {
    const src = `${F}  for (const it of items) { await qRun(DB, 'UPDATE t SET a=1', []) }\n}`
    expect(findLoopsInSource(src, 'f.js').map((h) => h.site)).toEqual(['f.js#outer'])
  })

  it('两跳：循环调本文件局部异步函数，该函数体内打 D1 ⇒ 仍算循环内', () => {
    const src = `${F}  for (const it of items) { await one(DB, it) }\n}\n`
      + 'async function one(DB) { await qRun(DB, \'UPDATE t SET a=1\', []) }\n'
    const sites = findLoopsInSource(src, 'f.js')
    expect(sites.map((h) => h.site)).toEqual(['f.js#outer'])
    expect(sites[0].via).toBe('one()')
  })

  it('map(async …) 体内的 qAll ⇒ 命中（不只是 for/while）', () => {
    const src = `${F}  await ids.map(async (id) => await qAll(DB, 'SELECT 1', [id]))\n}`
    expect(findLoopsInSource(src, 'f.js')).toHaveLength(1)
  })

  it('反例A：循环里的 D1 调用被注释掉 ⇒ 零命中（grep 型检测器会假阳性）', () => {
    const src = `${F}  for (const it of items) { /* await qRun(DB, 'UPDATE t SET a=1', []) */ }\n}`
    expect(findLoopsInSource(src, 'f.js')).toEqual([])
  })

  it('反例B：同一句 qRun 移出循环 ⇒ 零命中（判据不是「只要有 qRun 就红」）', () => {
    const src = `${F}  await qRun(DB, 'UPDATE t SET a=1', [])\n}`
    expect(findLoopsInSource(src, 'f.js')).toEqual([])
  })
})

describe('度量工具本体（mock 的 batch 语义）', () => {
  const SCHEMA = readFileSync('db/schema.sql', 'utf8')
  const cat = (id) => `INSERT INTO categories (_id, name, type, "order") VALUES ('${id}', 'n', 't', 1)`

  it('batch(3) 计 3 条语句 / 1 次往返（两条尺口径不同）', async () => {
    const db = openSqlite([SCHEMA])
    const D1 = createMeteredD1(db)
    const s0 = D1.__counters.statements
    const r0 = D1.__counters.roundTrips
    await D1.batch([0, 1, 2].map((i) => D1.prepare(cat(`b${i}`)).bind()))
    expect(D1.__counters.statements - s0).toBe(3)
    expect(D1.__counters.roundTrips - r0).toBe(1)
  })

  it('第 3 条撞主键 ⇒ 前 2 条整批回滚；对照组（无事务的朴素循环）必须留下脏数据', async () => {
    const db = openSqlite([SCHEMA])
    db.prepare(cat('seed')).run()
    const D1 = createMeteredD1(db)
    await expect(D1.batch([
      D1.prepare(cat('ok1')).bind(), D1.prepare(cat('ok2')).bind(), D1.prepare(cat('seed')).bind(),
    ])).rejects.toThrow()
    expect(db.prepare("SELECT COUNT(*) AS c FROM categories WHERE _id = 'ok1'").get().c).toBe(0)

    // 对照：证明这条断言不是永真——同样的三条语句不带事务，第 1 条就会留下
    const db2 = openSqlite([SCHEMA])
    db2.prepare(cat('seed')).run()
    for (const sql of [cat('ok1'), cat('ok2'), cat('seed')]) {
      try { db2.prepare(sql).run() } catch { /* 撞主键 */ }
    }
    expect(db2.prepare("SELECT COUNT(*) AS c FROM categories WHERE _id = 'ok1'").get().c).toBe(1)
  })

  it('qBatch 无「运行时不支持就退回循环」的兜底 ⇒ 缺 batch 必须响亮报错', async () => {
    await expect(qBatch({ prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) }, []))
      .rejects.toThrow()
  })
})

describe('真链路实测（两条尺必须给出不同答案）', () => {
  it('createOrder：往返斜率 0，语句斜率 1 —— 只看任一条尺都会漏', async () => {
    const { rows } = await measure()
    const order = rows.find((r) => r.name === 'P:createOrder')
    expect(order.rtSlope).toBe(0)
    expect(order.stSlope).toBe(1)
    expect(order.point[0].statements).toBeLessThan(order.point[1].statements)
  })

  it('seedReviews：20 条写入压成常数往返，但语句数仍是 20 量级（配额没省、延迟省了）', async () => {
    const { rows } = await measure()
    const seed = rows.find((r) => r.name === 'A:seedReviews')
    expect(seed.maxRoundTrips).toBeLessThanOrEqual(seed.rtMax)
    // 20 条种子 INSERT 仍逐条计语句（配额没省），省的是往返：两条尺分开才说明没把口径混为一谈
    expect(seed.maxStatements).toBeGreaterThanOrEqual(20)
    expect(seed.maxStatements).toBeLessThanOrEqual(STATEMENT_BUDGET_FREE)
  })
})
