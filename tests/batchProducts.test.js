import { describe, it, expect } from 'vitest'
import { batchUpdateProducts, batchDeleteProducts } from '../functions/lib/backend.js'

// mock D1：backend 走 DB.prepare(sql).bind(...params).run()/.all() 链；默认 changes=1（成功）
// allRows：SELECT 结果集（2026-09-18 R6：批量删除改为「存在性查询 + 批量 DELETE」，需 all 支持）
function makeDB(runImpl, allRows = []) {
  return {
    prepare(sql) {
      let bound = []
      const self = {
        bind(...params) { bound = params; return self },
        async run() { return runImpl ? runImpl(sql, bound) : { meta: { changes: 1 } } },
        async all() { return { results: typeof allRows === 'function' ? allRows(sql, bound) : allRows } },
      }
      return self
    },
    async qAll() { return [] },
    async qFirst() { return null },
  }
}

describe('batchUpdateProducts', () => {
  it('批量更新返回成功/失败明细（逐条定位）', async () => {
    // UPDATE products SET "enabled" = ?, "updatedAt" = ? WHERE _id = ? → params[2] = productId
    const db = makeDB((sql, params) => ({ meta: { changes: params[2] === 'p2' ? 0 : 1 } }))
    const res = await batchUpdateProducts(db, {
      items: [
        { productId: 'p1', updates: { enabled: true } },
        { productId: 'p2', updates: { enabled: true } },
      ],
    })
    expect(res.code).toBe(0)
    expect(res.data.updated).toBe(1)
    expect(res.data.total).toBe(2)
    expect(res.data.failed).toEqual([{ id: 'p2', message: '商品不存在' }])
  })

  it('空 items 返回错误', async () => {
    const res = await batchUpdateProducts(makeDB(), { items: [] })
    expect(res.code).toBe(-1)
  })

  it('超过 200 个拒绝', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ productId: 'p' + i, updates: {} }))
    const res = await batchUpdateProducts(makeDB(), { items })
    expect(res.code).toBe(-1)
  })

  it('非法图片 URL 单条进 failed 不整体失败', async () => {
    const res = await batchUpdateProducts(makeDB(), {
      items: [{ productId: 'p1', updates: { image: 'javascript:alert(1)' } }],
    })
    expect(res.code).toBe(0)
    expect(res.data.updated).toBe(0)
    expect(res.data.failed[0].message).toBe('商品主图格式无效')
  })
})

describe('batchDeleteProducts', () => {
  it('批量删除返回成功/失败明细', async () => {
    // R6 后为「1 次存在性查询 + 1 次批量 DELETE」：存在集合决定明细（p2 不存在 → failed）
    const db = makeDB(null, [{ _id: 'p1' }, { _id: 'p3' }])
    const res = await batchDeleteProducts(db, { productIds: ['p1', 'p2', 'p3'] })
    expect(res.code).toBe(0)
    expect(res.data.deleted).toBe(2)
    expect(res.data.total).toBe(3)
    expect(res.data.failed).toEqual([{ id: 'p2', message: '商品不存在' }])
  })

  it('空 productIds 返回错误', async () => {
    const res = await batchDeleteProducts(makeDB(), { productIds: [] })
    expect(res.code).toBe(-1)
  })
})
