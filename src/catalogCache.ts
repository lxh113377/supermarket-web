// 只读目录缓存（商品/分类）
//
// 为什么单独成模块：db.js 需要读写缓存，auth.js 的写操作需要让缓存失效。
// 若把缓存放在 db.js，auth.js 就要 import db.js，而 db.js 已 import auth.js 的 adminCall，
// 会形成循环依赖。抽成无依赖的独立模块，两边都只单向依赖它，彻底规避。

const _cache = new Map()

// 商品/分类极少变化，60s 内复用结果，砍掉重复的云函数 + 数据库请求。
export const CATALOG_CACHE_TTL = 60 * 1000

// P1-6：容量上限——评价缓存按商品累积，长会话下 Map 无上限增长。
// 超过上限时淘汰最早插入的一条（Map 保序，近似 FIFO；命中时会重插到末尾，等价于简易 LRU）。
export const CATALOG_CACHE_MAX = 200

export function cacheGet(key: string): unknown {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < CATALOG_CACHE_TTL) {
    // 防缓存污染：调用方拿到数组后若原地 sort/push 会污染 60s 内所有读取方
    //（localStore 同族问题已用 cloneArray 收口）。浅拷贝保持"每次读新容器"语义。
    return Array.isArray(hit.data) ? hit.data.slice() : hit.data
  }
  return null
}

export function cacheSet(key: string, data: unknown): void {
  // 写侧同样拷贝：调用方传入后若继续改动原数组，不应反向污染缓存
  const stored = Array.isArray(data) ? data.slice() : data
  // 命中后先删除再 set，把该键移到末尾（近似 LRU 的"最近使用"端）
  if (_cache.has(key)) _cache.delete(key)
  _cache.set(key, { ts: Date.now(), data: stored })
  while (_cache.size > CATALOG_CACHE_MAX) {
    const oldest = _cache.keys().next().value
    if (oldest === undefined) break
    _cache.delete(oldest)
  }
}

// 按 key 精确失效单条缓存（如某商品评价变更后只清该商品，不等 TTL 也不清全量）。
export function cacheDel(key: string): void {
  _cache.delete(key)
}

// 管理端写操作（增/改/删商品、分类）后必须调用，否则顾客端最长 60s 仍看到旧数据。
export function clearCatalogCache() {
  _cache.clear()
}
