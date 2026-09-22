// 前端图片压缩唯一实现：canvas 按最大边重采样 → JPEG dataURL + Blob。
// 此前同一逻辑在 reviewImages / ServiceFormPage / OrderConfirmPage 各写一份，
// 参数互不一致（640/0.5、800/0.7、800/0.6），改压缩策略要动三个文件 —— 收口到这里。
// 各调用方的差异只剩参数本身。

export interface CompressedImage {
  /** 预览 / 直传用 dataURL */
  dataUrl: string
  /** 需要 Blob 语义的调用方（如评价晒图上传） */
  blob: Blob
}

/** 按最大边等比缩到 maxSize 以内（只缩不放），JPEG 质量 quality（0~1） */
export function compressImageFile(
  file: File,
  { maxSize = 640, quality = 0.5 }: { maxSize?: number; quality?: number } = {},
): Promise<CompressedImage> {
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
