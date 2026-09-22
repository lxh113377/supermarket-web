// 评价晒图：压缩 + base64 dataURL 直传（不再依赖云存储）
// 图片以 base64 字符串存入 reviews.images，后端直接持久化，前端直接 <img src> 渲染。
// 压缩实现收口到 ./imageCompress（2026-09-23 三合一，本文件只保留评价场景的参数与语义）。
import { compressImageFile, type CompressedImage } from './imageCompress'

export type { CompressedImage }

// 压缩图片：canvas 最大边 640px、质量 0.5，同时产出 { dataUrl, blob }。
// ≤800KB 校验由调用方按 dataUrl 长度判断（与旧行为一致，阈值收紧防 D1 体积膨胀）。
export function compressImage(file: File, maxSize = 640, quality = 0.5): Promise<CompressedImage> {
  return compressImageFile(file, { maxSize, quality })
}

// 扩展名映射：压缩产物恒为 jpeg，但保留输入类型语义便于测试/扩展
export function fileExt(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}

// 评价图片走 base64 dataURL：前端直接渲染，无需云端解析（cloud:// 临时 URL 机制已随迁移废弃）
export async function resolveReviewImages(images: string[]): Promise<string[]> {
  return images
}

// 上传：将压缩后的 Blob 转为 base64 dataURL（不再依赖云存储直传）
export async function uploadReviewImages(blobs: Blob[]): Promise<string[]> {
  const out: string[] = []
  for (const blob of blobs) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(blob)
    })
    out.push(dataUrl)
  }
  return out
}
