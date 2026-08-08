import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isFileID,
  fileExt,
  getCachedTempUrl,
  clearTempUrlCache,
  resolveReviewImages,
  uploadReviewImages,
} from '../src/utils/reviewImages'

const FILE_ID = 'cloud://env-id.636c-xxx/reviews/123456-abc123.jpg'

describe('reviewImages 纯逻辑', () => {
  beforeEach(() => {
    clearTempUrlCache()
  })

  it('isFileID 只认 cloud:// 前缀', () => {
    expect(isFileID(FILE_ID)).toBe(true)
    expect(isFileID('data:image/jpeg;base64,xxx')).toBe(false)
    expect(isFileID('https://example.com/a.jpg')).toBe(false)
    expect(isFileID('/images/1.webp')).toBe(false)
  })

  it('fileExt 按 MIME 映射，未知归 jpg', () => {
    expect(fileExt('image/png')).toBe('png')
    expect(fileExt('image/webp')).toBe('webp')
    expect(fileExt('image/jpeg')).toBe('jpg')
    expect(fileExt('')).toBe('jpg')
    expect(fileExt('application/octet-stream')).toBe('jpg')
  })

  it('resolveReviewImages 旧 data/http 图直出并保持顺序', async () => {
    const resolver = vi.fn(async () => [])
    const input = ['data:image/jpeg;base64,a', 'https://cdn.example.com/1.jpg', '/images/1.webp']
    const out = await resolveReviewImages(input, { getTempFileURL: resolver })
    expect(out).toEqual(input)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('fileID 批量解析一次、保持顺序、命中后缓存不再请求', async () => {
    const idA = 'cloud://env/aaa.jpg'
    const idB = 'cloud://env/bbb.jpg'
    const resolver = vi.fn(async (list: string[]) =>
      list.map((fileID, i) => ({ fileID, tempFileURL: `https://temp/${i}.jpg` })),
    )

    const first = await resolveReviewImages([idA, 'data:image/jpeg;base64,x', idB], { getTempFileURL: resolver })
    expect(first).toEqual(['https://temp/0.jpg', 'data:image/jpeg;base64,x', 'https://temp/1.jpg'])
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith([idA, idB])

    const second = await resolveReviewImages([idB, idA], { getTempFileURL: resolver })
    expect(second).toEqual(['https://temp/1.jpg', 'https://temp/0.jpg'])
    expect(resolver).toHaveBeenCalledTimes(1) // 全部命中缓存
  })

  it('缓存过期判定 + 过期后重新解析', async () => {
    const idA = 'cloud://env/aaa.jpg'
    let call = 0
    const resolver = vi.fn(async (list: string[]) => {
      call += 1
      return list.map((fileID) => ({ fileID, tempFileURL: `https://temp/${call}.jpg` }))
    })

    await resolveReviewImages([idA], { getTempFileURL: resolver })
    expect(getCachedTempUrl(idA)).toBe('https://temp/1.jpg')

    // 模拟 91 分钟后的 now：缓存应判过期并清理
    const later = Date.now() + 91 * 60 * 1000
    expect(getCachedTempUrl(idA, later)).toBeNull()

    // 条目已被清理，再次解析会重新拉取
    const fresh = await resolveReviewImages([idA], { getTempFileURL: resolver })
    expect(fresh).toEqual(['https://temp/2.jpg'])
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('解析失败的文件保留原 fileID（渲染端 onError 兜底）', async () => {
    const idA = 'cloud://env/missing.jpg'
    const resolver = vi.fn(async () => [])
    const out = await resolveReviewImages([idA], { getTempFileURL: resolver })
    expect(out).toEqual([idA])
  })

  it('uploadReviewImages 逐张上传、cloudPath 含 reviews/ 前缀与正确扩展名、保持顺序', async () => {
    const uploader = vi.fn(async (_blob: Blob, cloudPath: string) => `cloud://env/${cloudPath}`)
    const blobs = [
      new Blob(['x'], { type: 'image/jpeg' }),
      new Blob(['y'], { type: 'image/png' }),
      new Blob(['z'], { type: 'image/webp' }),
    ]
    const ids = await uploadReviewImages(blobs, { uploadFile: uploader })
    expect(ids).toHaveLength(3)
    expect(uploader).toHaveBeenCalledTimes(3)
    ids.forEach((id, i) => {
      expect(id).toBe(`cloud://env/reviews/${id.split('reviews/')[1]}`)
      expect(uploader.mock.calls[i][1]).toMatch(/^reviews\/\d+-[a-z0-9]{6}\.(jpg|png|webp)$/)
    })
    expect(uploader.mock.calls[0][1]).toMatch(/\.jpg$/)
    expect(uploader.mock.calls[1][1]).toMatch(/\.png$/)
    expect(uploader.mock.calls[2][1]).toMatch(/\.webp$/)
  })

  it('上传任一张失败立即抛错', async () => {
    const uploader = vi.fn(async () => {
      throw new Error('upload failed')
    })
    await expect(uploadReviewImages([new Blob(['x'], { type: 'image/jpeg' })], { uploadFile: uploader }))
      .rejects.toThrow('upload failed')
  })
})
