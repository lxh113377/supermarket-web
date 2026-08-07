// 服务表单提交 + 离线队列（网络恢复后自动重试）
import { IS_CLOUD } from '../cloudbase.js'
import { adminCall, pickSubmissionFields } from '../auth.js'

function safeParse(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

const PENDING_QUEUE_KEY = 'sm_pending_submissions'

function getPendingQueue() {
  return safeParse(PENDING_QUEUE_KEY)
}

function savePendingQueue(queue) {
  try { localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue)) } catch {}
}

// 重试离线队列中的提交
export async function flushPendingSubmissions() {
  if (!IS_CLOUD) return
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
}

// 网络恢复时自动重试 + 页面加载时补刷离线队列。
// 抽成显式初始化函数，避免在 import 时产生副作用（测试可控、避免重复注册监听）。
// 由应用入口 main.jsx 启动时调用一次。
export function initSubmissionSync() {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => flushPendingSubmissions())
  // 页面加载时也尝试一次（延迟执行，避免阻塞首屏）
  setTimeout(() => flushPendingSubmissions(), 3000)
}

export async function createSubmission(submission) {
  const clean = pickSubmissionFields(submission)
  if (!IS_CLOUD) {
    const key = 'sm_submissions'
    const list = safeParse(key)
    const record = { ...clean, _id: 'sub_' + Date.now(), status: 'pending' }
    list.unshift(record)
    localStorage.setItem(key, JSON.stringify(list))
    return { id: record._id }
  }
  try {
    const result = await adminCall('createSubmission', clean)
    if (result.code !== 0) throw new Error(result.message || '提交失败')
    return { id: result.data?.id }
  } catch (e) {
    console.warn('[db] cloud createSubmission failed, queuing for retry:', e.message)
    // 存入离线队列，网络恢复后自动重试
    const queue = getPendingQueue()
    queue.push(clean)
    savePendingQueue(queue)
    // 同时存本地让用户能看到
    const key = 'sm_submissions'
    const list = safeParse(key)
    const record = { ...clean, _id: 'sub_' + Date.now(), status: 'pending', _offline: true }
    list.unshift(record)
    localStorage.setItem(key, JSON.stringify(list))
    return { id: record._id, offline: true }
  }
}

export async function getSubmissions() {
  if (!IS_CLOUD) {
    return safeParse('sm_submissions')
  }
  const result = await adminCall('getSubmissions', {})
  if (result.code === 0) return result.data || []
  throw new Error(result.message || '获取提交列表失败')
}
