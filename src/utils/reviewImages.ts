// 评价晒图：压缩 + base64 dataURL 直传（不再依赖云存储）
// 图片以 base64 字符串存入 reviews.images，后端直接持久化，前端直接 <img src> 渲染。
// 压缩实现收口到 ./imageCompress（2026-09-23 三合一，本文件只保留评价场景的参数与语义）。
import { compressImageFile, MAX_IMAGE_DATAURL_CHARS, type CompressedImage } from './imageCompress'

export type { CompressedImage }

// 压缩图片：canvas 最大边 640px、起始质量 0.5，同时产出 { dataUrl, blob }。
// 第三十八轮起把**预算**直接传进压缩器（maxBytes = 与单语句预算同值的字符数），压不进就自动降质，
// 而不是整张丢掉。本文件原注释写的是「≤800KB 校验由调用方按 dataUrl 长度判断」——
// 那句比代码旧：调用方早就改用 MAX_IMAGE_DATAURL_CHARS(90,000)，800KB 那条线 R37 已判为虚设。
export function compressImage(
  file: File, maxSize = 640, quality = 0.5, maxBytes: number = MAX_IMAGE_DATAURL_CHARS,
): Promise<CompressedImage> {
  return compressImageFile(file, { maxSize, quality, maxBytes })
}

// 扩展名映射：压缩产物恒为 jpeg，但保留输入类型语义便于测试/扩展
export function fileExt(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}

// 评价图片走 base64 dataURL：前端直接渲染，无需云端解析（cloud:// 临时 URL 机制已随迁移废弃）。
// R2 就绪（2026-09-30 对标 P2）：`r2:<key>` 引用在配置了 VITE_R2_PUBLIC_BASE 的构建里拼成可渲染地址；
// 未配置时原样透传（后端尚不产出 r2: 引用，行为与旧版一致）。
// 基址每次调用现取（而非常量冻结）：构建期烘焙值在模块加载时已定，测试可用 stubEnv 覆盖。
export function r2PublicBase(): string {
  const raw = (import.meta.env.VITE_R2_PUBLIC_BASE || '') as string
  return raw.replace(/\/+$/, '')
}

export async function resolveReviewImages(images: string[]): Promise<string[]> {
  const base = r2PublicBase()
  if (!base) return images
  return images.map((img) =>
    typeof img === 'string' && img.startsWith('r2:') ? `${base}/${img.slice(3)}` : img,
  )
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
