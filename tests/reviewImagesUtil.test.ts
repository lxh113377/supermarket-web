// @vitest-environment jsdom
// 评价晒图工具直测（七轮 H2：reviewImages.ts 原 33%——ReviewForm 测试把它整包 mock 掉了，
// 这几个函数本身反而没被直接验证过）。
import { describe, it, expect, vi } from 'vitest'
const compressImageFile = vi.hoisted(() => vi.fn())
vi.mock('../src/utils/imageCompress', () => ({ compressImageFile }))

import { compressImage, fileExt, resolveReviewImages, uploadReviewImages } from '../src/utils/reviewImages'

describe('compressImage 参数口径', () => {
  it('评价场景固定 640/0.5（三处重复实现收口后的唯一口径）', async () => {
    compressImageFile.mockResolvedValue({ dataUrl: 'd', blob: new Blob(['x']) })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await compressImage(file)
    expect(compressImageFile).toHaveBeenLastCalledWith(file, { maxSize: 640, quality: 0.5 })
    await compressImage(file, 800, 0.7)
    expect(compressImageFile).toHaveBeenLastCalledWith(file, { maxSize: 800, quality: 0.7 })
  })
})

describe('fileExt 类型映射', () => {
  it('png/webp 保名，其余（含未知类型）落 jpg', () => {
    expect(fileExt('image/png')).toBe('png')
    expect(fileExt('image/webp')).toBe('webp')
    expect(fileExt('image/jpeg')).toBe('jpg')
    expect(fileExt('application/octet-stream')).toBe('jpg')
    expect(fileExt('')).toBe('jpg')
  })
})

describe('resolveReviewImages', () => {
  it('base64 直存方案下是恒等映射（云存储临时 URL 机制已随迁移废弃，别再假设它会异步换址）', async () => {
    const imgs = ['data:image/jpeg;base64,AAA', '/images/1.webp']
    await expect(resolveReviewImages(imgs)).resolves.toEqual(imgs)
    await expect(resolveReviewImages([])).resolves.toEqual([])
  })
})

describe('uploadReviewImages', () => {
  it('Blob → dataURL 数组，顺序与入参一致（多图不能错位）', async () => {
    const blobs = [new Blob(['one'], { type: 'image/jpeg' }), new Blob(['two'], { type: 'image/jpeg' })]
    const out = await uploadReviewImages(blobs)
    expect(out).toHaveLength(2)
    expect(out[0].startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(out[1]).not.toBe(out[0])
  })

  it('空数组直接返回空（无图评价不走这步）', async () => {
    await expect(uploadReviewImages([])).resolves.toEqual([])
  })

  it('读取失败时抛「图片读取失败」而不是塞进 undefined', async () => {
    const orig = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      this.onerror?.call(this, new Event('error'))
    } as never
    await expect(uploadReviewImages([new Blob(['x'], { type: 'image/jpeg' })])).rejects.toThrow('图片读取失败')
    FileReader.prototype.readAsDataURL = orig
  })
})
