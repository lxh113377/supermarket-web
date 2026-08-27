// 服务表单提交 + 离线队列（网络恢复后自动重试）
import { IS_CLOUD } from '../cloudbase'
import { adminCall, pickSubmissionFields } from '../auth'
import type { Submission } from '../types'

function safeParse<T>(key: string): T {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as T } catch { return [] as unknown as T }
}

const PENDING_QUEUE_KEY = 'sm_pending_submissions'

function getPendingQueue(): Record<string, unknown>[] {
  return safeParse<Record<string, unknown>[]>(PENDING_QUEUE_KEY)
}

function savePendingQueue(queue: Record<string, unknown>[]): void {
  try { localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue)) } catch {}
}

// 重试离线队列中的提交
// P1-3：模块级重入锁——'online' 事件与 3s 定时器并发触发时防重复提交队列
let flushing = false
export async function flushPendingSubmissions(): Promise<void> {
  if (!IS_CLOUD || flushing) return
  flushing = true
  try {
    const queue = getPendingQueue()
    if (queue.length === 0) return
    const remaining = []
    for (const item of queue) {
      try {
        const result = await adminCall('createSubmission', item)
        if (result.code !== 0) remaining.push(item)
      } catch {
        remaining.push(item)
      }
    }
    savePendingQueue(remaining)
  } finally {
    flushing = false
  }
}

// 网络恢复时自动重试 + 页面加载时补刷离线队列。
// 抽成显式初始化函数，避免在 import 时产生副作用（测试可控、避免重复注册监听）。
// 由应用入口 main.tsx 启动时调用一次。
export function initSubmissionSync(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => flushPendingSubmissions())
  // 页面加载时也尝试一次（延迟执行，避免阻塞首屏）
  setTimeout(() => flushPendingSubmissions(), 3000)
}

export async function createSubmission(submission: Record<string, unknown>): Promise<{ id: string; offline?: boolean }> {
  const clean = pickSubmissionFields(submission)
  if (!IS_CLOUD) {
    const key = 'sm_submissions'
    const list = safeParse<Record<string, unknown>[]>(key)
    const record = { ...clean, _id: 'sub_' + Date.now(), status: 'pending' }
    list.unshift(record)
    // P1-2：与 savePendingQueue 一致的存储容错（隐私模式/超配额不中断提交）
    try { localStorage.setItem(key, JSON.stringify(list)) } catch {}
    return { id: record._id }
  }
  try {
    const result = await adminCall('createSubmission', clean)
    if (result.code !== 0) throw new Error(result.message || '提交失败')
    return { id: result.data?.id }
  } catch (e) {
    console.warn('[db] cloud createSubmission failed, queuing for retry:', e instanceof Error ? e.message : String(e))
    // 存入离线队列，网络恢复后自动重试
    const queue = getPendingQueue()
    queue.push(clean)
    savePendingQueue(queue)
    // 同时存本地让用户能看到
    const key = 'sm_submissions'
    const list = safeParse<Record<string, unknown>[]>(key)
    const record = { ...clean, _id: 'sub_' + Date.now(), status: 'pending', _offline: true }
    list.unshift(record)
    // P1-2：存储容错，不因 localStorage 异常丢失"已离线保存"的结果
    try { localStorage.setItem(key, JSON.stringify(list)) } catch {}
    return { id: record._id, offline: true }
  }
}

export async function getSubmissions(): Promise<Submission[]> {
  if (!IS_CLOUD) {
    return safeParse<Submission[]>('sm_submissions')
  }
  const result = await adminCall('getSubmissions', {})
  if (result.code === 0) return (result.data || []) as Submission[]
  throw new Error(result.message || '获取提交列表失败')
}
