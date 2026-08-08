// 商品与分类读取（顾客端走 HTTP API + 缓存，管理端走全量接口）
import { IS_CLOUD } from '../cloudbase'
import { adminCall } from '../auth'
import { cacheGet, cacheSet } from '../catalogCache'
import { getLocalCategories, getLocalProducts } from '../localStore'
import type { Category, Product } from '../types'

// 顾客端分类 — 走 HTTP API，不依赖 SDK 匿名登录
export async function getCategories(): Promise<Category[]> {
  if (!IS_CLOUD) return getLocalCategories()
  const cacheKey = 'publicCategories'
  const cached = cacheGet(cacheKey)
  if (cached) return cached as Category[]
  try {
    const result = await adminCall('getPublicCategories', {})
    if (result.code === 0 && result.data?.length) {
      cacheSet(cacheKey, result.data)
      return result.data
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] getPublicCategories failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return getLocalCategories()
  }
}

// 顾客端商品（仅上架）— 走 HTTP API，不依赖 SDK 匿名登录
export async function getProducts(): Promise<Product[]> {
  if (!IS_CLOUD) return getLocalProducts().filter((p) => p.enabled !== false)
  const cacheKey = 'publicProducts'
  const cached = cacheGet(cacheKey)
  if (cached) return cached as Product[]
  try {
    const result = await adminCall('getPublicProducts', {})
    if (result.code === 0 && result.data?.length) {
      cacheSet(cacheKey, result.data)
      return result.data as Product[]
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] getPublicProducts failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return getLocalProducts().filter((p) => p.enabled !== false)
  }
}

// 管理端商品（全部，含下架）— 走 HTTP API，与写操作同路径
export async function getAdminProducts(): Promise<Product[]> {
  if (!IS_CLOUD) return getLocalProducts()
  try {
    const result = await adminCall('getProducts', {})
    if (result.code === 0 && result.data) return result.data as Product[]
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] cloud getAdminProducts failed, using local fallback:', e instanceof Error ? e.message : String(e))
    return getLocalProducts()
  }
}
