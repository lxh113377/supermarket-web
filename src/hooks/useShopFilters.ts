import { useCallback, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Category } from '../types'

export const SORT_OPTIONS = [
  { key: 'default', label: '默认' },
  { key: 'price-asc', label: '价格↑' },
  { key: 'price-desc', label: '价格↓' },
] as const

export type SortKey = (typeof SORT_OPTIONS)[number]['key']

const SORT_KEYS: readonly string[] = SORT_OPTIONS.map((o) => o.key)

/** URL 可被手输，排序非法值一律归零到 default，不给未定义行为留口子。 */
export function normalizeSort(raw: string | null | undefined): SortKey {
  return raw && SORT_KEYS.includes(raw) ? (raw as SortKey) : 'default'
}

/** 子分类为空即「全部」，不进路径，避免 /shop/food/ 这种尾斜杠地址。 */
export function shopPath(categoryId: string, subId = ''): string {
  return subId ? `/shop/${categoryId}/${subId}` : `/shop/${categoryId}`
}

function toSearch(q: string, sort: SortKey): string {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (sort !== 'default') sp.set('sort', sort)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/**
 * 商城筛选态：URL 是唯一真相。
 *
 * 原先 activeTop / activeSub / search / sortBy 散在 CustomerPage 的 useState 里，
 * 且 TopNav 又自存一份 activeTop，两边靠回调单向同步 —— 结果是「零食页」没有可访问
 * 地址：刷新回默认分类、返回丢筛选、无法分享。改为路径参数 + query 后两处状态合一。
 */
export function useShopFilters(categories: Category[]) {
  const navigate = useNavigate()
  const params = useParams<{ categoryId?: string; subId?: string }>()
  const [searchParams] = useSearchParams()

  // 分类必须真实存在：手输错 id 或分类被下架时回落第一个分类，
  // 而不是渲染空列表 —— 空列表会被读成「这个类没货」。
  const category = useMemo(
    () => categories.find((c) => c._id === params.categoryId) ?? categories[0] ?? null,
    [categories, params.categoryId],
  )

  // 子分类必须属于当前分类，否则视为「全部」而非空结果。
  const subId = useMemo(
    () => (category?.subcategories.some((s) => s.id === params.subId) ? params.subId! : ''),
    [category, params.subId],
  )

  const q = searchParams.get('q') ?? ''
  const sort = normalizeSort(searchParams.get('sort'))

  const go = useCallback(
    (path: string, nextQ: string, nextSort: SortKey) => {
      navigate({ pathname: path, search: toSearch(nextQ, nextSort) }, { replace: true })
    },
    [navigate],
  )

  const selectCategory = useCallback(
    (id: string) => go(shopPath(id), q, sort),
    [go, q, sort],
  )

  const selectSub = useCallback(
    (id: string) => {
      if (category) go(shopPath(category._id, id), q, sort)
    },
    [category, go, q, sort],
  )

  const setQuery = useCallback(
    (value: string) => {
      if (category) go(shopPath(category._id, subId), value, sort)
    },
    [category, subId, go, sort],
  )

  const setSortBy = useCallback(
    (value: string) => {
      if (category) go(shopPath(category._id, subId), q, normalizeSort(value))
    },
    [category, subId, go, q],
  )

  return { category, subId, q, sort, selectCategory, selectSub, setQuery, setSortBy }
}
