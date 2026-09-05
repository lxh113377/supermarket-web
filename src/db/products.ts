// 商品与分类读取（顾客端走 HTTP API + 缓存，管理端走全量接口）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, publicCall } from '../api/client'
import { cacheGet, cacheSet } from '../catalogCache'
import { getLocalCategories, getLocalProducts } from '../localStore'
import type { Category, Product } from '../types'

// 持久目录缓存（localStorage，24h TTL）：内存缓存 60s 之外的第二道兜底。
// 弱网/离线时 fetch 失败 → 回退此缓存（比 localStore 本地模式更贴近真实数据）。
const PERSIST_TTL = 24 * 60 * 60 * 1000
// L4（2026-09-05）：弱网/离线时每次失败都 console.warn 会刷屏，仅告警首次（会话内）
const _warnedKeys = new Set<string>()
function warnOnce(key: string, msg: string, err: unknown): void {
  if (_warnedKeys.has(key)) return
  _warnedKeys.add(key)
  console.warn(`[db] ${msg}:`, err instanceof Error ? err.message : String(err))
}
function readPersist<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > PERSIST_TTL) return null
    return Array.isArray(parsed.data) ? parsed.data : null
  } catch {
    return null
  }
}
function writePersist(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // localStorage 不可用（隐私模式/SSR）时静默跳过，不影响主流程
  }
}

// 顾客端分类 — 走 HTTP API，不依赖 SDK 匿名登录
export async function getCategories(): Promise<Category[]> {
  if (!IS_CLOUD) return getLocalCategories()
  const cacheKey = 'publicCategories'
  const cached = cacheGet(cacheKey)
  if (cached) return cached as Category[]
  try {
    const result = await publicCall('getPublicCategories', {})
    // P1-1：空分类/空列表是合法状态——以 code===0 且 data 为数组为准（原 data?.length 会把空列表误判为失败、回退旧缓存显示陈旧数据）
    if (result.code === 0 && Array.isArray(result.data)) {
      cacheSet(cacheKey, result.data)
      writePersist('sm_catalog_categories', result.data)
      return result.data
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] getPublicCategories 云端失败，已回退本地缓存数据（可能过期）:', e instanceof Error ? e.message : String(e))
    const persisted = readPersist<Category>('sm_catalog_categories')
    if (persisted) return persisted
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
    const result = await publicCall('getPublicProducts', {})
    // P1-1：空商品列表是合法状态（全下架/清空）——不再因空数组回退旧缓存
    if (result.code === 0 && Array.isArray(result.data)) {
      cacheSet(cacheKey, result.data)
      writePersist('sm_catalog_products', result.data)
      return result.data as Product[]
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    warnOnce('products', 'getPublicProducts 云端失败，已回退本地缓存数据（可能过期）', e)
    const persisted = readPersist<Product>('sm_catalog_products')
    if (persisted) return persisted
    return getLocalProducts().filter((p) => p.enabled !== false)
  }
}

// 管理端商品（全部，含下架）— 走 HTTP API，与写操作同路径
// 管理端是数据可信面：读取失败必须显式报错，禁止静默回退本地（掩盖后端故障）
export async function getAdminProducts(): Promise<Product[]> {
  if (!IS_CLOUD) return getLocalProducts()
  const result = await adminCall('getProducts', {})
  if (result.code === 0 && result.data) return result.data as Product[]
  throw new Error(result.message || '获取商品列表失败')
}
