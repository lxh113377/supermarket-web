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

/**
 * 前端图片 dataUrl 的字节预算（第三十七轮 R37-H2）—— 与 `functions/lib/shared.js` 的
 * `MAX_STATEMENT_PAYLOAD_CHARS` **同值**（同值由 `tests/limitCapParity.test.ts` 钉死）。
 * 出处不是拍的：D1 平台事实 `d1_statement_bytes = 100000 bytes/语句`，留 10% 给 SQL 关键字与转义。
 * 改前这里写着 `2 * 1024 * 1024`（约预算的 21 倍）：过滤形同虚设，图过了前端也过不了平台，
 * 用户看到的是"提交失败"而不是"图太大"。
 */
export const MAX_IMAGE_DATAURL_CHARS = 90_000

/**
 * 降质阶梯（第三十八轮 R38-H3）：从起始质量按 0.8 倍往下走，最多 steps 档。
 * 抽成纯函数是因为它决定"这张图还能不能再小一点"，不该只在浏览器里才跑得动（可测性）。
 */
export function qualityLadder(start = 0.5, steps = 4): number[] {
  const out: number[] = []
  let q = Math.min(1, Math.max(0.05, start))
  for (let i = 0; i < steps; i++) {
    const v = Number(q.toFixed(3))
    if (!out.includes(v)) out.push(v)
    q *= 0.8
  }
  return out
}

/** 按最大边等比缩到 maxSize 以内（只缩不放），JPEG 质量从 quality 起；
 *  给了 maxBytes 就**先反复降质**，压不进预算也只返回最小一档（丢不丢由调用方决定）。 */
export function compressImageFile(
  file: File,
  { maxSize = 640, quality = 0.5, maxBytes = 0 }: { maxSize?: number; quality?: number; maxBytes?: number } = {},
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
        // 第三十八轮 R38-H3：改前压一次就交卷，超预算的整张被调用方过滤掉 ⇒
        // 用户只看到「部分图片过大，已自动跳过」，凭空少一张且无从补救。
        // 现在先在阶梯里找到第一张能进预算的；全都不合格才返回最小一档（此时调用方的过滤才生效）。
        const ladder = qualityLadder(quality)
        let chosenQ = ladder[ladder.length - 1]
        let dataUrl = ''
        for (const q of ladder) {
          dataUrl = canvas.toDataURL('image/jpeg', q)
          chosenQ = q
          if (!maxBytes || dataUrl.length <= maxBytes) break
        }
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('图片压缩失败'))
            return
          }
          resolve({ dataUrl, blob })
        }, 'image/jpeg', chosenQ)
      }
      img.onerror = reject
      img.src = result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
