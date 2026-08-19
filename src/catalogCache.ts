// 只读目录缓存（商品/分类）
//
// 为什么单独成模块：db.js 需要读写缓存，auth.js 的写操作需要让缓存失效。
// 若把缓存放在 db.js，auth.js 就要 import db.js，而 db.js 已 import auth.js 的 adminCall，
// 会形成循环依赖。抽成无依赖的独立模块，两边都只单向依赖它，彻底规避。

const _cache = new Map()

// 商品/分类极少变化，60s 内复用结果，砍掉重复的云函数 + 数据库请求。
export const CATALOG_CACHE_TTL = 60 * 1000

export function cacheGet(key: string): unknown {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < CATALOG_CACHE_TTL) return hit.data
  return null
}

export function cacheSet(key: string, data: unknown): void {
  _cache.set(key, { ts: Date.now(), data })
}

// 按 key 精确失效单条缓存（如某商品评价变更后只清该商品，不等 TTL 也不清全量）。
export function cacheDel(key: string): void {
  _cache.delete(key)
}

// 管理端写操作（增/改/删商品、分类）后必须调用，否则顾客端最长 60s 仍看到旧数据。
export function clearCatalogCache() {
  _cache.clear()
}
