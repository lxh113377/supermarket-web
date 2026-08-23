import { describe, it, expect } from 'vitest'
import {
  fileExt,
  resolveReviewImages,
} from '../src/utils/reviewImages'

// 说明：评价晒图已迁移为「base64 dataURL 直传，不依赖云存储」
// （src/utils/reviewImages.ts）。旧 cloud:// 临时 URL 解析/缓存、云上传
// （getTempFileURL / uploadFile / getCachedTempUrl / isFileID）已随迁移废弃并删除，
// 相应陈旧测试一并移除。uploadReviewImages 是 FileReader.readAsDataURL 的薄包装，
// 依赖浏览器 FileReader，不作单测（由 ProductDetailPage 提交路径覆盖）。

describe('reviewImages 纯逻辑', () => {
  it('fileExt 按 MIME 映射，未知归 jpg', () => {
    expect(fileExt('image/png')).toBe('png')
    expect(fileExt('image/webp')).toBe('webp')
    expect(fileExt('image/jpeg')).toBe('jpg')
    expect(fileExt('')).toBe('jpg')
    expect(fileExt('application/octet-stream')).toBe('jpg')
  })

  it('resolveReviewImages 原样返回并保持顺序（data/http/cloud 一律直出，不再云端解析）', async () => {
    const input = [
      'data:image/jpeg;base64,a',
      'https://cdn.example.com/1.jpg',
      '/images/1.webp',
      'cloud://env/legacy.jpg',
    ]
    const out = await resolveReviewImages(input)
    expect(out).toEqual(input)
  })
})