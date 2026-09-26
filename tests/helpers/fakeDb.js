// 测试用 D1 假实现（非 .test.js，不会被 vitest 收集为用例）
// 按 SQL 中的表名路由结果集，并记录所有 INSERT，用于断言「留痕是否真的落库」。
export function fakeDb({
  orders = [],
  reviews = [],
  products = [],
  aiCalls = [],
  agg = null,
  inserts = [],
  statements = [],
  failInsert = false,
} = {}) {
  const tableOf = (sql) => {
    const m = /FROM\s+"?([A-Za-z_]\w*)"?/i.exec(sql)
    return m ? m[1].toLowerCase() : ''
  }
  const rowsFor = (sql) => {
    if (/COUNT\(\*\)/i.test(sql)) {
      return [agg || { total: 0, okCount: 0, fallbackCount: 0, avgLatency: null }]
    }
    switch (tableOf(sql)) {
      case 'orders':
        return orders.map((o) => ({ ...o, items: JSON.stringify(o.items || []) }))
      case 'reviews':
        return reviews
      case 'products':
        return products
      case 'ai_calls':
        return aiCalls
      default:
        return []
    }
  }
  return {
    // D1 batch()（第十四轮起 reserveStock/releaseStock/seedReviews 走这条通道）：
    // 假实现不模拟事务回滚，只把已 bind 的语句逐条执行并返回 D1Result 数组；
    // statements 计数在 prepare() 已发生，这里不重复计（否则批量用例的语句数会虚高）。
    async batch(list) {
      const results = []
      for (const s of list) results.push(await s.run())
      return results
    },
    prepare(sql) {
      statements.push(sql)
      return {
        bind(...params) {
          return {
            all: async () => ({ results: rowsFor(sql) }),
            first: async () => rowsFor(sql)[0] ?? null,
            run: async () => {
              if (/^\s*INSERT/i.test(sql)) {
                if (failInsert) throw new Error('D1 insert failed')
                inserts.push({ sql, params })
              }
              return { success: true, meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}

// 内存版 Workers KV（用于验证缓存命中 / 失效 / 分键）
export function fakeKv() {
  const store = new Map()
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => {
      store.set(k, v)
    },
    delete: async (k) => {
      store.delete(k)
    },
  }
}
