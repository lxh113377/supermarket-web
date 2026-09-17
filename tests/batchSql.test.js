// 双向迭代 R6（2026-09-18）：批量操作的 SQL 语句数断言。
// 借鉴门店 Q1 的教训——「报告写已修、实盘没修」只能靠断言杜绝：
// 这里用计数断言把「批量操作不得退化回循环内 await」永久钉住。
import { describe, it, expect } from 'vitest'
import { batchDeleteProducts } from '../functions/lib/actions/products.js'
import { recalculateOrders } from '../functions/lib/actions/orders.js'
import { fakeDb } from './helpers/fakeDb.js'

describe('batchDeleteProducts 语句数', () => {
  it('200 个 id 只用 2 条语句（1 次存在性查询 + 1 次批量删除），不随 N 增长', async () => {
    const statements = []
    const products = [{ _id: 'p1' }, { _id: 'p2' }, { _id: 'p3' }]
    const ids = [...products.map((p) => p._id), ...Array.from({ length: 197 }, (_, i) => `ghost-${i}`)]
    const res = await batchDeleteProducts(fakeDb({ products, statements }), { productIds: ids })
    expect(res.code).toBe(0)
    expect(res.data.deleted).toBe(3)
    expect(res.data.failed).toHaveLength(197)
    expect(statements.filter((s) => /^\s*DELETE/i.test(s))).toHaveLength(1)
    expect(statements).toHaveLength(2)
  })

  it('重复 id 与非法 id 均正确计入 failed，不重复删除', async () => {
    const statements = []
    const res = await batchDeleteProducts(
      fakeDb({ products: [{ _id: 'p1' }], statements }),
      { productIds: ['p1', 'p1', '', null, 'missing'] },
    )
    expect(res.data.deleted).toBe(1)
    // failed = '' / null / 'missing'（'p1' 与重复的 'p1' 只删一次，不计入失败）
    expect(res.data.failed).toHaveLength(3)
    expect(statements.filter((s) => /^\s*DELETE/i.test(s))).toHaveLength(1)
  })
})

describe('recalculateOrders 语句数', () => {
  const mkOrders = (n) =>
    Array.from({ length: n }, (_, i) => ({
      _id: `o${i}`,
      items: [{ price: 2, quantity: 3 }],
      totalAmount: 0, // 与 6 不符 → 全部需要修正
    }))

  it('120 单全部需修正时 UPDATE 语句 ≤ ceil(120/50)=3，而非 120', async () => {
    const statements = []
    const res = await recalculateOrders(fakeDb({ orders: mkOrders(120), statements }))
    expect(res.code).toBe(0)
    expect(res.data.fixed).toBe(120)
    const updates = statements.filter((s) => /^\s*UPDATE/i.test(s))
    expect(updates.length).toBeLessThanOrEqual(3)
    expect(updates.length).toBeLessThan(120)
  })

  it('无需修正时不发 UPDATE', async () => {
    const statements = []
    const ok = Array.from({ length: 10 }, (_, i) => ({
      _id: `o${i}`,
      items: [{ price: 2, quantity: 3 }],
      totalAmount: 6,
    }))
    const res = await recalculateOrders(fakeDb({ orders: ok, statements }))
    expect(res.data.fixed).toBe(0)
    expect(statements.filter((s) => /^\s*UPDATE/i.test(s))).toHaveLength(0)
  })
})
