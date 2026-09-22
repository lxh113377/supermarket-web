import React, { useState } from 'react'
import { addReview } from '../../db'
import { compressImage, uploadReviewImages } from '../../utils/reviewImages'

// 写评价表单子组件（M6 拆分自 ProductDetailPage，2026-09-05）
// 图片压缩/上传/表单状态全部内聚，提交后通过 onPublished 通知父刷新。

export default function ReviewForm({ productOrder, onPublished }: { productOrder: number; onPublished: (() => void) | undefined }) {
  const [user, setUser] = useState('')
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [blobs, setBlobs] = useState<Blob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')

  const handleImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    setMsg('')
    // 原页面硬上限 5 张（服务端 REVIEW 图片 ≤5 张），label 文案"最多 3 张"为历史笔误，兼容保留
    const remaining = 5 - images.length
    if (remaining <= 0) {
      setMsg('最多上传 5 张图片')
      return
    }
    const valid = files
      .slice(0, remaining)
      .filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024)
    try {
      const compressed = (await Promise.all(valid.map((f) => compressImage(f))))
        .filter((d) => d.dataUrl.length <= 2 * 1024 * 1024)
      setImages((prev) => [...prev, ...compressed.map((d) => d.dataUrl)].slice(0, 5))
      setBlobs((prev) => [...prev, ...compressed.map((d) => d.blob)].slice(0, 5))
      if (compressed.length < valid.length) setMsg('部分图片过大，已自动跳过')
    } catch {
      setMsg('图片处理失败，请重试')
    }
  }

  const submit = async () => {
    if (!text.trim()) return
    setSubmitting(true)
    setMsg('')
    try {
      // 评价晒图：压缩后 base64 dataURL 直传入库（D1 reviews.images）
      let uploadedImages: string[] = []
      if (blobs.length > 0) {
        try {
          uploadedImages = await uploadReviewImages(blobs)
        } catch {
          setMsg('图片上传失败：请检查云存储配置后重试')
          return
        }
      }
      await addReview(productOrder, {
        user: user.trim() || '匿名用户',
        rating,
        text: text.trim(),
        images: uploadedImages,
      })
      setText('')
      setUser('')
      setRating(5)
      setImages([])
      setBlobs([])
      setMsg('评价已发布 ✓')
      // 通知父组件刷新本地+云端评价列表（原页面行为保真）
      onPublished?.()
    } catch (e) {
      setMsg('发布失败：' + (e instanceof Error ? e.message : '网络错误'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-4">
      <h3 className="section-title mb-4">写评价</h3>
      <div className="space-y-4">
        <input
          type="text"
          aria-label="昵称（选填，默认匿名用户）"
          placeholder="昵称（选填，默认匿名用户）"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          maxLength={20}
          className="input-base"
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">评分</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n}星`}
                className={`text-2xl transition-all duration-150 ${n <= rating ? 'text-brand-400 scale-110' : 'text-gray-200 hover:text-brand-200 hover:scale-105'}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <textarea
          aria-label="评价内容（最多 500 字）"
          placeholder="说说你的感受...（最多500字）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input-base resize-none"
          rows={3}
          maxLength={500}
        />
        {/* 晒图（最多 3 张，自动压缩） */}
        <div>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-100">
                  <img
                    src={src}
                    alt={`待发布图片 ${i + 1}`}
                    width={160}
                    height={160}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => {
                      setImages((prev) => prev.filter((_, j) => j !== i))
                      setBlobs((prev) => prev.filter((_, j) => j !== i))
                    }}
                    aria-label={`删除图片 ${i + 1}`}
                    className="tap-44 absolute top-0.5 right-0.5 w-6 h-6 bg-black/50 text-white rounded-full text-xs flex items-center justify-center"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length < 5 && (
            <label className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-4 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/30 transition-all duration-300 flex flex-col items-center cursor-pointer">
              <span className="text-xl mb-1">📷</span>
              添加图片（选填，最多 5 张）
              <input type="file" accept="image/*" multiple aria-label="选择要上传的评价图片" className="hidden" onChange={handleImages} />
            </label>
          )}
        </div>
        {/* 发布结果需播报（成功/失败均是瞬时视觉提示） */}
        <div role="status" aria-live="polite">
          {msg && (
            <p className={`text-xs ${msg.includes('✓') ? 'text-green-600' : 'text-red-400'}`}>{msg}</p>
          )}
        </div>
        <button
          onClick={submit}
          disabled={!text.trim() || submitting}
          className="btn-primary w-full py-3"
        >
          {submitting ? '发布中...' : '发布评价'}
        </button>
      </div>
    </div>
  )
}