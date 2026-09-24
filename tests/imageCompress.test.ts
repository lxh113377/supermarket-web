// @vitest-environment jsdom
// 图片压缩唯一实现（utils/imageCompress）单测（七轮 H2，原覆盖 0%）：
// 三处调用方（评价晒图 / 服务表单 / 下单转账截图）共用它，等比缩放算错＝所有上传一起坏。
// jsdom 无真 canvas，故按边界 stub：Image 触发 onload、canvas 返回假 ctx 与固定 dataURL。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImageFile } from '../src/utils/imageCompress'

type Ctor = { new (): HTMLImageElement }
let OriginalImage: Ctor
let OriginalGetContext: unknown
let OriginalToBlob: unknown
let OriginalToDataURL: unknown

function mkFile(name = 'a.png', type = 'image/png'): File {
  return new File(['some-bytes'], name, { type })
}

/** 设定"原图尺寸"并返回可断言的 drawImage 参数记录 */
function stubImage(width: number, height: number, opts: { failLoad?: boolean; noResult?: boolean } = {}) {
  const drawn: Array<{ w: number; h: number }> = []
  class FakeImg {
    onload: (() => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    width = width
    height = height
    set src(_v: string) {
      queueMicrotask(() => {
        if (opts.failLoad) this.onerror?.(new Event('error'))
        else this.onload?.()
      })
    }
    get src() { return '' }
  }
  vi.stubGlobal('Image', FakeImg as unknown as Ctor)
  const ctx = { drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => { drawn.push({ w, h }) } }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => opts.noResult ? null : ctx) as never
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,AAAA') as never
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' }))) as never
  return drawn
}

beforeEach(() => {
  OriginalImage = globalThis.Image
  OriginalGetContext = HTMLCanvasElement.prototype.getContext
  OriginalToBlob = HTMLCanvasElement.prototype.toBlob
  OriginalToDataURL = HTMLCanvasElement.prototype.toDataURL
})
afterEach(() => {
  vi.unstubAllGlobals()
  HTMLCanvasElement.prototype.getContext = OriginalGetContext as never
  HTMLCanvasElement.prototype.toBlob = OriginalToBlob as never
  HTMLCanvasElement.prototype.toDataURL = OriginalToDataURL as never
  globalThis.Image = OriginalImage
})

describe('compressImageFile 等比缩放', () => {
  it('宽>高的横图：宽压到 maxSize、高按比例取整（1200x800 @640 → 640x427）', async () => {
    const drawn = stubImage(1200, 800)
    const r = await compressImageFile(mkFile(), { maxSize: 640, quality: 0.5 })
    expect(drawn).toEqual([{ w: 640, h: 427 }])
    expect(r.dataUrl).toBe('data:image/jpeg;base64,AAAA')
    expect(r.blob.type).toBe('image/jpeg')
  })

  it('高>宽的竖图：以高为基准（800x1200 @640 → 427x640）', async () => {
    const drawn = stubImage(800, 1200)
    await compressImageFile(mkFile(), { maxSize: 640 })
    expect(drawn).toEqual([{ w: 427, h: 640 }])
  })

  it('只缩不放：小于 maxSize 的图原样输出（900x600 @1024 → 900x600）', async () => {
    const drawn = stubImage(900, 600)
    await compressImageFile(mkFile(), { maxSize: 1024 })
    expect(drawn).toEqual([{ w: 900, h: 600 }])
  })

  it('缺省参数走评价场景口径（640）', async () => {
    const drawn = stubImage(2000, 1000)
    await compressImageFile(mkFile())
    expect(drawn).toEqual([{ w: 640, h: 320 }])
  })
})

describe('compressImageFile 失败面（调用方据此提示用户）', () => {
  it('图片解码失败 → reject（onerror 直传）', async () => {
    stubImage(100, 100, { failLoad: true })
    await expect(compressImageFile(mkFile())).rejects.toBeTruthy()
  })

  it('canvas 上下文不可得 → reject「canvas 不可用」，不静默返回空图', async () => {
    stubImage(100, 100, { noResult: true })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
    await expect(compressImageFile(mkFile())).rejects.toThrow('canvas 不可用')
  })

  it('toBlob 返回 null（内存/编码失败）→ reject「图片压缩失败」', async () => {
    stubImage(100, 100)
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(null)) as never
    await expect(compressImageFile(mkFile())).rejects.toThrow('图片压缩失败')
  })

  it('FileReader 结果非字符串 → reject「图片读取失败」', async () => {
    stubImage(100, 100)
    const orig = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      Object.defineProperty(this, 'result', { value: new ArrayBuffer(2), configurable: true })
      this.onload?.call(this, new Event('load'))
    } as never
    await expect(compressImageFile(mkFile())).rejects.toThrow('图片读取失败')
    FileReader.prototype.readAsDataURL = orig
  })
})
