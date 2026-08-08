// 评价读写（本地 localStorage + 云端 sm_reviews）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, pickReviewFields } from '../auth'
import { getLocalReviews, addLocalReview } from '../localStore'
import type { Review } from '../types'

// 提交评价：云端优先（公开 action addPublicReview），失败降级本地
// 顾客/管理员共用同一入口，落库字段由服务端白名单强制收敛
export async function addReview(
  productOrder: number | string,
  review: { user?: string; rating?: number; text: string; images?: string[] },
): Promise<unknown> {
  const clean = pickReviewFields({
    productOrder: Number(productOrder),
    user: review.user || '匿名用户',
    rating: Number(review.rating) || 5,
    text: String(review.text || ''),
    images: Array.isArray(review.images) ? review.images : undefined,
  })
  if (IS_CLOUD) {
    try {
      const result = await adminCall('addPublicReview', clean)
      if (result.code === 0) return result.data
      throw new Error(result.message || '提交评价失败')
    } catch (e) {
      console.warn('[db] cloud addReview failed, saving locally:', e instanceof Error ? e.message : String(e))
    }
  }
  return addLocalReview(productOrder, review)
}

// 读取本地评价（用户自己提交的）
export function getLocalProductReviews(productOrder: number | string): Review[] {
  return getLocalReviews(productOrder)
}

// 云端评价（顾客端读取，公开接口）
export async function getCloudReviews(productOrder: number | string): Promise<Review[]> {
  if (!IS_CLOUD) return []
  try {
    const result = await adminCall('getReviews', { productOrder: Number(productOrder) })
    if (result.code === 0) return (result.data || []) as Review[]
    console.warn('[db] getCloudReviews failed:', result.message)
    return []
  } catch (e) {
    console.warn('[db] getCloudReviews error:', e instanceof Error ? e.message : String(e))
    return []
  }
}

// 管理员新增评价到云端（管理端独立入口，走需鉴权的 addReview action）
export async function addCloudReview(
  productOrder: number | string,
  review: { user?: string; rating?: number; text?: string; images?: string[] },
): Promise<Review> {
  if (!IS_CLOUD) return addLocalReview(productOrder, review)
  const payload = pickReviewFields({
    productOrder: Number(productOrder),
    user: review.user || '管理员',
    rating: Number(review.rating) || 5,
    text: String(review.text || ''),
    images: Array.isArray(review.images) ? review.images : undefined,
  })
  const result = await adminCall('addReview', payload)
  if (result.code !== 0) throw new Error(result.message || '新增评价失败')
  return result.data as Review
}

// 管理员删除评价
export async function deleteCloudReview(reviewId: string): Promise<boolean> {
  if (!IS_CLOUD) return true
  const result = await adminCall('deleteReview', { reviewId })
  if (result.code !== 0) throw new Error(result.message || '删除评价失败')
  return true
}

// 管理员获取所有评价（管理后台用）
export async function getAllReviews(): Promise<Review[]> {
  if (!IS_CLOUD) return []
  const result = await adminCall('getAllReviews', {})
  if (result.code === 0) return (result.data || []) as Review[]
  throw new Error(result.message || '获取评价列表失败')
}
