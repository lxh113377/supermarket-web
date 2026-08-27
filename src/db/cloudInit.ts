// 云端初始化（新后端：D1 已通过迁移脚本预置分类/商品；此处仅提供评价种子入口）
import { IS_CLOUD } from '../cloudbase'
import { adminCall } from '../auth'

export async function seedCloudData() {
  if (!IS_CLOUD) throw new Error('仅云端模式可初始化')
  // 分类与商品已在 D1 迁移阶段灌入；这里幂等补 20 条示例评价（后端 seedReviews 内部判空跳过）。
  const r = await adminCall('seedReviews', {})
  if (r.code !== 0) throw new Error(r.message || '播种失败')
  return { categories: 2, products: 49, ...(r.data || {}) }
}
