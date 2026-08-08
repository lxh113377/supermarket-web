// 评价晒图：压缩 + 云存储直传 + fileID 临时 URL 会话缓存
// 设计：纯逻辑全部依赖注入（uploadFile / getTempFileURL），浏览器边界只在默认实现里，
// 便于 vitest 直接测缓存/顺序/兼容逻辑，不依赖真实 SDK。
import { getApp } from '../cloudbase'

export interface CompressedImage {
  /** 本地预览用 dataURL（旧行为，UI 零改动） */
  dataUrl: string
  /** 直传云存储用 Blob */
  blob: Blob
}

// 压缩图片：canvas 最大边 800px、质量 0.6，同时产出 { dataUrl, blob }。
// ≤2MB 校验由调用方按 dataUrl 长度判断（与旧行为一致）。
export function compressImage(file: File, maxSize = 800, quality = 0.6): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== 'string') {
        reject(new Error('图片读取失败'))
        return
      }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          } else {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas 不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('图片压缩失败'))
            return
          }
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            blob,
          })
        }, 'image/jpeg', quality)
      }
      img.onerror = reject
      img.src = result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 扩展名映射：压缩产物恒为 jpeg，但保留输入类型语义便于测试/扩展
export function fileExt(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}

export function isFileID(src: string): boolean {
  return typeof src === 'string' && src.startsWith('cloud://')
}

// ---- 临时 URL 会话缓存（TTL 90 分钟，短于临时 URL 有效期）----
const TEMP_URL_TTL = 90 * 60 * 1000
const tempUrlCache = new Map<string, { url: string; expiresAt: number }>()

export function getCachedTempUrl(fileID: string, now = Date.now()): string | null {
  const hit = tempUrlCache.get(fileID)
  if (hit && hit.expiresAt > now) return hit.url
  if (hit) tempUrlCache.delete(fileID)
  return null
}

export function clearTempUrlCache(): void {
  tempUrlCache.clear()
}

export interface ResolvedFile {
  fileID: string
  tempFileURL: string
}

export type TempUrlResolver = (fileList: string[]) => Promise<ResolvedFile[]>

async function defaultTempUrlResolver(fileList: string[]): Promise<ResolvedFile[]> {
  const app = await getApp()
  if (!app) throw new Error('云存储不可用（未配置 VITE_CB_ENV_ID）')
  const res = await app.getTempFileURL({ fileList })
  const list: ResolvedFile[] = Array.isArray(res?.fileList) ? res.fileList : []
  return list
    .filter((item: { fileID?: string; tempFileURL?: string }) => Boolean(item.fileID && item.tempFileURL))
    .map((item: { fileID: string; tempFileURL: string }) => ({ fileID: item.fileID, tempFileURL: item.tempFileURL }))
}

// 批量解析：非 fileID（旧 base64 / http 图）直出；fileID 命中缓存直出，缺失批量拉取。
// 返回与入参同序的 URL 数组；解析失败的文件保留原值（渲染端 onError 兜底）。
export async function resolveReviewImages(
  images: string[],
  deps: { getTempFileURL?: TempUrlResolver } = {},
): Promise<string[]> {
  const resolver = deps.getTempFileURL || defaultTempUrlResolver
  const now = Date.now()
  const out = [...images]
  const missing: Array<{ fileID: string; index: number }> = []

  images.forEach((src, i) => {
    if (!isFileID(src)) return
    const cached = getCachedTempUrl(src, now)
    if (cached) out[i] = cached
    else missing.push({ fileID: src, index: i })
  })

  if (missing.length > 0) {
    const resolved = await resolver(missing.map((m) => m.fileID))
    const byID = new Map(resolved.map((r) => [r.fileID, r.tempFileURL]))
    for (const { fileID, index } of missing) {
      const url = byID.get(fileID)
      if (url) {
        tempUrlCache.set(fileID, { url, expiresAt: now + TEMP_URL_TTL })
        out[index] = url
      }
    }
  }
  return out
}

export type Uploader = (blob: Blob, cloudPath: string) => Promise<string>

async function defaultUploader(blob: Blob, cloudPath: string): Promise<string> {
  const app = await getApp()
  if (!app) throw new Error('云存储不可用（未配置 VITE_CB_ENV_ID）')
  const res = await app.uploadFile({ cloudPath, filePath: blob })
  const fileID = res?.fileID
  if (!fileID) throw new Error('上传未返回 fileID')
  return String(fileID)
}

// 逐张直传，返回 fileID 数组；任一失败抛错，调用方中止提交
export async function uploadReviewImages(
  blobs: Blob[],
  deps: { uploadFile?: Uploader } = {},
): Promise<string[]> {
  const upload = deps.uploadFile || defaultUploader
  const fileIDs: string[] = []
  for (const blob of blobs) {
    const cloudPath = `reviews/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt(blob.type || 'image/jpeg')}`
    fileIDs.push(await upload(blob, cloudPath))
  }
  return fileIDs
}
