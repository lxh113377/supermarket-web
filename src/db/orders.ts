// 订单读写（走 HTTP API，服务端重算金额）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, pickOrderFields } from '../auth'
import { getLocalOrders, addLocalOrder } from '../localStore'
import type { Order } from '../types'

// 创建订单（走 API，服务端重算金额，防客户端篡改）
export async function createOrder(order: Record<string, unknown>): Promise<{ id: string; localFallback?: boolean }> {
  const clean = pickOrderFields(order)
  if (!IS_CLOUD) {
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
  try {
    const result = await adminCall('createOrder', clean)
    if (result.code !== 0) throw new Error(result.message || '创建订单失败')
    return { id: result.data.id }
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
