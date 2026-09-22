// 商品图片 URL 拼装 —— 全站唯一真相源。
//
// 硬约定（与后端 / 构建脚本一致，改这里等于改全站）：
//   商品原图 800w = /images/{order}.webp
//   商品缩略图 400w = /images/sm/{order}.webp
// 站点根即域名根（github.io 为用户页仓库），故使用根绝对路径是安全的。
//
// 此前这段拼装在 ProductCard / ProductsTab / ProductGallery / ProductDetailPage
// 四处各写了一遍，导致「加了 sm 缩略图后只有 2 个文件接上 srcSet」的漏改。

/** order 可能由后端回传 number 或 string（D1），统一归一化为可比较的字符串 */
function normalizeOrder(order?: number | string | null): string | null {
  if (order === undefined || order === null) return null
  const s = String(order).trim()
  return s === '' ? null : s
}

/** 商品原图（800w）；order 缺失返回 null（调用方据此渲染占位图） */
export function productImageUrl(order?: number | string | null): string | null {
  const o = normalizeOrder(order)
  return o ? `/images/${o}.webp` : null
}

/** 商品缩略图（400w，列表场景优先用它省流量） */
export function productThumbUrl(order?: number | string | null): string | null {
  const o = normalizeOrder(order)
  return o ? `/images/sm/${o}.webp` : null
}

/**
 * 响应式 srcSet：小图 400w + 原图 800w。
 * 缺任一张时返回 undefined，避免浏览器选中不存在的候选图。
 */
export function productSrcSet(order?: number | string | null): string | undefined {
  const thumb = productThumbUrl(order)
  const full = productImageUrl(order)
  return thumb && full ? `${thumb} 400w, ${full} 800w` : undefined
}
