// 评价读写（本地 localStorage + 云端 sm_reviews）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, publicCall, pickReviewFields } from '../auth'
import { cacheGet, cacheSet, cacheDel, withCacheInvalidation } from '../catalogCache'
import { getLocalReviews, addLocalReview } from '../localStore'
import type { Review } from '../types'

// 评价相对稳定，60s 内复用（复用 catalogCache 的全局 TTL）：详情页重复进入/重复点击省一次
// 云函数+DB 往返；提交/删除评价后精确失效对应商品缓存，无需等 TTL。

function reviewsCacheKey(productOrder: number | string): string {
  return `reviews:${productOrder}`
}

// 管理端"全部评价"列表缓存键（ReviewsTab 反复进入不再重复拉全量，且服务端已投影砍掉 base64）
const ALL_REVIEWS_KEY = 'allReviews'

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
      // 失效放 finally：请求可能已落库但响应丢失，只在本商品评价列表这一键上失效（不动商品/分类缓存）
      const result = await withCacheInvalidation(
        () => adminCall('addPublicReview', clean),
        () => cacheDel(reviewsCacheKey(productOrder)),
      )
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

// 云端评价（顾客端读取，公开接口）— 60s TTL 缓存，提交/删除后精确失效
export async function getCloudReviews(productOrder: number | string): Promise<Review[]> {
  if (!IS_CLOUD) return []
  const cacheKey = reviewsCacheKey(productOrder)
  const cached = cacheGet(cacheKey)
  if (cached) return cached as Review[]
  try {
    const result = await publicCall('getReviews', { productOrder: Number(productOrder) })
    if (result.code === 0) {
      const data = (result.data || []) as Review[]
      cacheSet(cacheKey, data)
      return data
    }
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
  // 原写法把两次 cacheDel 放在抛错之后 ⇒ code!==0 或网络抛错时该商品与全量列表都脏读 60s
  const result = await withCacheInvalidation(
    () => adminCall('addReview', payload),
    () => {
      cacheDel(reviewsCacheKey(productOrder))
      cacheDel(ALL_REVIEWS_KEY) // 失效管理端全量评价缓存，避免新增后列表停留旧数据
    },
  )
  if (result.code !== 0) throw new Error(result.message || '新增评价失败')
  return result.data as Review
}

// 管理员删除评价
export async function deleteCloudReview(reviewId: string): Promise<boolean> {
  if (!IS_CLOUD) return true
  // 未知 reviewId 属于哪个商品，保守全清可接受；失效放 finally 覆盖抛错路径
  const result = await withCacheInvalidation(() => adminCall('deleteReview', { reviewId }))
  if (result.code !== 0) throw new Error(result.message || '删除评价失败')
  return true
}

// 管理员获取所有评价（管理后台用）
// 全部评价列表 60s TTL 缓存（复用 catalogCache 的全局 TTL）：ReviewsTab 反复进入不再重复
// 拉全量文档；新增/删除评价已分别 cacheDel(ALL_REVIEWS_KEY)/clearCatalogCache 失效。
export async function getAllReviews(): Promise<Review[]> {
  if (!IS_CLOUD) return []
  const cached = cacheGet(ALL_REVIEWS_KEY)
  if (cached) return cached as Review[]
  const result = await adminCall('getAllReviews', {})
  if (result.code === 0) {
    cacheSet(ALL_REVIEWS_KEY, result.data)
    return (result.data || []) as Review[]
  }
  throw new Error(result.message || '获取评价列表失败')
}
