// KV 缓存工具（functions/lib/cache.js）
// M1/M2（2026-09-05）：复用 RATE_KV namespace（key 前缀 cache:* 与 rate:* 隔离），
// KV 瞬时异常/未绑定（本地 mock）时优雅回落直查 DB，与限流降级链同构，不引入新绑定。
// TTL 由调用方以秒传入；写操作后须 del 对应 key 保证即时失效。

export function kvCacheGet(kv, key) {
  if (!kv || typeof kv.get !== 'function') return null
  return kv.get(key)
}

export async function kvCacheSet(env, key, value, ttlSeconds) {
  const kv = env?.RATE_KV
  if (!kv || typeof kv.put !== 'function') return
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(1, ttlSeconds) })
  } catch (e) {
    // 缓存写失败不影响主链路（降级为直查 DB）
    console.error('[cache] put failed:', key, e)
  }
}

// 读缓存：返回 null 表示未命中/无 KV/解析失败
export async function kvCacheGetJSON(env, key) {
  const kv = env?.RATE_KV
  if (!kv || typeof kv.get !== 'function') return null
  try {
    const raw = await kv.get(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function kvCacheDel(env, key) {
  const kv = env?.RATE_KV
  if (!kv || typeof kv.delete !== 'function') return
  try {
    await kv.delete(key)
  } catch (e) {
    console.error('[cache] delete failed:', key, e)
  }
}

// 公共目录缓存整体失效（商品/分类读写后调用；key 前缀统一 cache:public:*）
export async function invalidatePublicCatalog(env) {
  await Promise.all([
    kvCacheDel(env, 'cache:public:products'),
    kvCacheDel(env, 'cache:public:categories'),
  ])
}