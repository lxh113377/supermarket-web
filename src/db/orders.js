// 订单读写（走 SDK 鉴权 / 云函数服务端重算金额）
import { IS_CLOUD } from '../cloudbase.js'
import { adminCall, pickOrderFields } from '../auth.js'
import { cloud, ensure } from './cloud.js'
import { getLocalOrders, addLocalOrder } from '../localStore.js'

// 创建订单（走云函数，服务端重算金额，防客户端篡改）
export async function createOrder(order) {
  const clean = pickOrderFields(order)
  if (!IS_CLOUD) {
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
  try {
    const result = await adminCall('createOrder', clean)
    if (result.code !== 0) throw new Error(result.message || '创建订单失败')
    return { id: result.data.id }
  } catch (e) {
    console.warn('[db] cloud createOrder failed, using local fallback:', e.message)
    return { id: addLocalOrder(clean)._id, localFallback: true }
  }
}

// 查询单个订单（走 SDK 鉴权，仅管理端）
export async function getOrderById(orderId) {
  if (!IS_CLOUD) return getLocalOrders().find(o => o._id === orderId) || null
  try {
    await ensure()
    const res = await (await cloud()).collection('sm_orders').doc(orderId).get()
    return res.data?.[0] || res.data || null
  } catch (e) {
    console.warn('[db] getOrderById failed:', e.message)
    return null
  }
}

// 查询订单（分页，仅管理端）
export async function getOrders({ page = 1, pageSize = 50 } = {}) {
  if (!IS_CLOUD) return getLocalOrders()
  try {
    await ensure()
    const res = await (await cloud()).collection('sm_orders')
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('[db] cloud getOrders failed, using local fallback:', e.message)
    return getLocalOrders()
  }
}
