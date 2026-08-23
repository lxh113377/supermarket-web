// 评价晒图：压缩 + base64 dataURL 直传（不再依赖云存储）
// 图片以 base64 字符串存入 reviews.images，后端直接持久化，前端直接 <img src> 渲染。

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
