// API 客户端层（src/api/client.ts）
// 从 src/auth.ts 拆出（2026-09-05 M3）：纯 HTTP 调用职责，不含业务字段逻辑。
// - adminCall：管理接口，固定走 VITE_CB_API_BASE（/web），携带会话密钥
// - publicCall：公开接口，固定走 VITE_CB_PUBLIC_API_BASE（/pub；未配置时回退 /web）
//
// M3 决策（2026-09-05）：前端不再硬编码 PUBLIC_ACTIONS action 白名单集合
// （原 auth.ts 用 action 名判断端点，与后端 functions/lib/security.js 双份维护易漂移）。
// 端点改由调用方语义显式选择：publicCall=公开（免密钥）、adminCall=管理（带密钥）。
// 后端 security.js 仍是唯一白名单信任边界（/pub 对非公开 action 兜底拒绝）。

import type { ApiResult } from '../types'

const ADMIN_KEY_STORAGE = 'sm_admin_key'

function getCachedKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

// AI 接口默认超时 30s（服务端 callDifyChat/callDifyCompletion 为 20s 上游硬上限，blocking 模式长回复
// 必须让前端超时 > 服务端超时，否则 AI 回答会被前端 AbortController 掐断。普通接口维持 15s。）
const DEFAULT_TIMEOUT_MS = 15000
const AI_TIMEOUT_MS = 30000

// AI 相关 action：需要更宽松的超时（见 AI_TIMEOUT_MS 注释）
const AI_ACTIONS = new Set(['aiChat', 'aiAdvice'])

function resolveBaseUrl(isPublic: boolean): string {
  if (isPublic) {
    if (import.meta.env.VITE_CB_PUBLIC_API_BASE) return import.meta.env.VITE_CB_PUBLIC_API_BASE
  }
  if (import.meta.env.VITE_CB_API_BASE) return import.meta.env.VITE_CB_API_BASE
  // 未配置则显式返回空，由 callApi 抛明确错误（不再拼任何兜底域名，避免误导）
  return ''
}

// 统一的云函数 HTTP 调用（不依赖 SDK 鉴权）
async function callApi<T = unknown>(
  isPublic: boolean,
  action: string,
  adminKey: string,
  payload: Record<string, unknown>,
  timeoutMs?: number,
): Promise<ApiResult<T>> {
  const url = resolveBaseUrl(isPublic)
  if (!url) throw new Error('未配置接口地址（VITE_CB_API_BASE / VITE_CB_PUBLIC_API_BASE），无法连接后端')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? (AI_ACTIONS.has(action) ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS))
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, adminKey: adminKey || '', payload: payload || {} }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (typeof data.code !== 'number') {
      throw new Error('云函数返回异常（可能网络不可达或跨域被拦截）')
    }
    // 平台边界断言收敛到一处：data 来自远端 JSON，业务侧用泛型 T 声明期望形状
    return data as ApiResult<T>
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 登录：校验密钥，成功则缓存到会话（走 /web 管理端点）
export async function loginAdmin(key: string): Promise<boolean> {
  const data = await callApi(false, 'login', key, {})
  if (data.code === 0) {
    try {
      sessionStorage.setItem(ADMIN_KEY_STORAGE, key)
    } catch {}
    return true
  }
  // 把云函数返回的真实错误（如"密钥错误"/"服务未配置 ADMIN_KEY"）抛给前端显示
  throw new Error(data.message || '密钥错误')
}

// 管理接口：每次带上缓存的会话密钥
export async function adminCall<T = unknown>(action: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<ApiResult<T>> {
  return callApi<T>(false, action, getCachedKey(), payload, timeoutMs)
}

// 公开接口（顾客端免密钥，走 /pub 端点）
export async function publicCall<T = unknown>(action: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<ApiResult<T>> {
  return callApi<T>(true, action, '', payload, timeoutMs)
}

export async function verifyAdminKey(key: string): Promise<boolean> {
  try {
    const data = await callApi(false, 'verifyKey', key, {})
    return data.code === 0
  } catch {
    return false
  }
}