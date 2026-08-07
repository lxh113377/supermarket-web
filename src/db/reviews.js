// 评价读写（本地 localStorage + 云端 sm_reviews）
import { IS_CLOUD } from '../cloudbase.js'
import { adminCall, pickReviewFields } from '../auth.js'
import { getLocalReviews, addLocalReview } from '../localStore.js'

// 提交评价（本地持久化，无需登录/购买，像视频评论区）
// 顾客提交存 localStorage；管理员通过后台提交的会走云函数存云端 sm_reviews
export function addReview(productOrder, review) {
  return addLocalReview(productOrder, review)
}

// 读取本地评价（用户自己提交的）
export function getLocalProductReviews(productOrder) {
  return getLocalReviews(productOrder)
}

// 云端评价（顾客端读取，公开接口）
export async function getCloudReviews(productOrder) {
  if (!IS_CLOUD) return []
  try {
    const result = await adminCall('getReviews', { productOrder: Number(productOrder) })
    if (result.code === 0) return result.data || []
    console.warn('[db] getCloudReviews failed:', result.message)
    return []
  } catch (e) {
    console.warn('[db] getCloudReviews error:', e.message)
    return []
  }
}

// 管理员新增评价到云端
export async function addCloudReview(productOrder, review) {
  if (!IS_CLOUD) return addLocalReview(productOrder, review)
  const payload = pickReviewFields({
    productOrder: Number(productOrder),
    user: review.user || '管理员',
    rating: Number(review.rating) || 5,
    text: String(review.text || ''),
  })
  const result = await adminCall('addReview', payload)
  if (result.code !== 0) throw new Error(result.message || '新增评价失败')
  return result.data
}

// 管理员删除评价
export async function deleteCloudReview(reviewId) {
  if (!IS_CLOUD) return true
  const result = await adminCall('deleteReview', { reviewId })
  if (result.code !== 0) throw new Error(result.message || '删除评价失败')
  return true
}

// 管理员获取所有评价（管理后台用）
export async function getAllReviews() {
  if (!IS_CLOUD) return []
  const result = await adminCall('getAllReviews', {})
  if (result.code === 0) return result.data || []
  throw new Error(result.message || '获取评价列表失败')
}
