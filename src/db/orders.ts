// 订单读写（走 HTTP API，服务端重算金额）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, publicCall, pickOrderFields } from '../auth'
import { getLocalOrders, addLocalOrder } from '../localStore'
import type { Order } from '../types'

// 创建订单（走 API，服务端重算金额，防客户端篡改）
export async function createOrder(order: Record<string, unknown>): Promise<{ id: string; localFallback?: boolean }> {
  const clean = pickOrderFields(order)
  if (!IS_CLOUD) {
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
  try {
    const result = await publicCall<{ id: string }>('createOrder', clean)
    if (result.code !== 0) throw new Error(result.message || '创建订单失败')
    return { id: result.data?.id ?? '' }
  } catch (e) {
    console.warn('[db] cloud createOrder failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
}

// 查询单个订单（管理端）
export async function getOrderById(orderId: string): Promise<Order | null> {
  if (!IS_CLOUD) return getLocalOrders().find(o => o._id === orderId) || null
  try {
    const r = await adminCall('getOrder', { orderId })
    if (r.code !== 0) return null
    return (r.data || null) as Order | null
  } catch (e) {
    console.warn('[db] getOrderById failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

// 查询订单（分页，管理端）
export async function getOrders(
  { page = 1, pageSize = 50 }: { page?: number; pageSize?: number } = {},
): Promise<Order[]> {
  if (!IS_CLOUD) return getLocalOrders()
  try {
    const r = await adminCall('getOrders', { page, pageSize })
    if (r.code !== 0) return getLocalOrders()
    return (r.data || []) as Order[]
  } catch (e) {
    console.warn('[db] cloud getOrders failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return getLocalOrders()
  }
}

// 查询全量订单（管理端看板/列表；后端 getOrders 默认 pageSize=50，直接取 data 会截断，
// 这里按 hasMore 循环拉全量，避免看板聚合/搜索/翻页只覆盖最新 N 单。maxPages 防异常死循环）
// H1-1 增量模式：since 为上次同步游标（ISO）时只拉 updatedAt 更大的订单（新建+状态变更），
// 返回最大 updatedAt 作为下一次游标；无 since 时为全量拉取。调用方把结果按 _id 合并进已有列表。
export async function getAllOrders(
  { since }: { since?: string | null } = {},
): Promise<{ orders: Order[]; maxUpdatedAt: string | null }> {
  if (!IS_CLOUD) return { orders: getLocalOrders(), maxUpdatedAt: null }
  const PAGE_SIZE = 100
  const MAX_PAGES = 20
  const seen = new Set<string>()
  const all: Order[] = []
  let maxUpdatedAt: string | null = null
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await adminCall<Order[]>('getOrders', { page, pageSize: PAGE_SIZE, since: since || undefined })
      if (r.code !== 0) return { orders: getLocalOrders(), maxUpdatedAt: null }
      const rows = r.data || []
      for (const o of rows) {
        // 增量模式下 updatedAt 满足 since<o.updatedAt 升序排列
        if (o._id && !seen.has(o._id)) {
          seen.add(o._id)
          all.push(o)
          const t = o.updatedAt ? String(o.updatedAt) : ''
          if (t && (!maxUpdatedAt || t > maxUpdatedAt)) maxUpdatedAt = t
        }
      }
      if (!r.hasMore || rows.length < PAGE_SIZE) break
    }
    return { orders: all, maxUpdatedAt }
  } catch (e) {
    console.warn('[db] cloud getAllOrders failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return { orders: getLocalOrders(), maxUpdatedAt: null }
  }
}
