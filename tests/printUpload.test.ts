// 打印文件上传：直传成功 / 端点不可达降级 / 业务拒绝必须抛（三条路都要有腿）。
//
// 降级路径是这轮最容易埋雷的地方：它把"上传失败"从阻断变成可继续，
// 若判据写宽了，业务拒绝（类型不符、体积超限、限流）也会被悄悄降级成内联，
// 顾客当场看到"上传成功"、提交时却被服务端整条退回 —— 比直接报错更糟。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadPrintFile, resolvePrintFileUrl } from '../src/utils/printUpload'
import { MAX_INLINE_UPLOAD_BYTES } from '../src/pages/print/print.config'

const API = 'https://api.example.com/pub'
const smallPdf = () => new File([new Uint8Array([1, 2, 3])], '报告.pdf', { type: 'application/pdf' })

beforeEach(() => {
  vi.stubEnv('VITE_CB_PUBLIC_API_BASE', API)
  vi.stubEnv('VITE_R2_PUBLIC_BASE', 'https://files.example.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('直传成功', () => {
  it('回 r2:<key> 引用，inline = false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { key: 'print/2026-10/abc.pdf', size: 3 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await uploadPrintFile(smallPdf())
    expect(r.ref).toBe('r2:print/2026-10/abc.pdf')
    expect(r.inline).toBe(false)
    expect(r.name).toBe('报告.pdf')

    // 端点由 /pub 基址推出，不新增一个环境变量（少一处构建期漏配）
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/upload')
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData)
  })
})

describe('端点不可达 ⇒ 降级为内联', () => {
  it('fetch 直接抛（断网 / 本地 dev 没有这条路由）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const r = await uploadPrintFile(smallPdf())
    expect(r.inline).toBe(true)
    expect(r.ref.startsWith('data:application/pdf;base64,')).toBe(true)
  })
  it('服务端明确回 print_storage_unavailable（桶没建 / 绑定名不符）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: -1, errorCode: 'print_storage_unavailable', kind: 'platform', message: '文件存储未就绪' }),
    }))
    const r = await uploadPrintFile(smallPdf())
    expect(r.inline).toBe(true)
  })
  it('响应不是 JSON（dev server 的 404 HTML）也算不可用', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error('not json') } }))
    const r = await uploadPrintFile(smallPdf())
    expect(r.inline).toBe(true)
  })
  it('没配接口基址 ⇒ 直接走内联（本地演示模式）', async () => {
    vi.stubEnv('VITE_CB_PUBLIC_API_BASE', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await uploadPrintFile(smallPdf())
    expect(r.inline).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('业务拒绝 ⇒ 必须抛，不许降级', () => {
  it('类型被拒（print_file_type_denied）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: -1, errorCode: 'print_file_type_denied', message: '不支持的文件类型' }),
    }))
    await expect(uploadPrintFile(smallPdf())).rejects.toThrow('不支持的文件类型')
  })
  it('限流（rate_limited）也不降级 —— 降级只会把限流变成"悄悄换个通道继续打"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: -1, errorCode: 'rate_limited', message: '操作过于频繁，请稍后再试' }),
    }))
    await expect(uploadPrintFile(smallPdf())).rejects.toThrow('过于频繁')
  })
  it('降级态下超过内联上限 ⇒ 抛明确错误（不能静默提交一个不完整的文件）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const big = new File([new Uint8Array(MAX_INLINE_UPLOAD_BYTES + 1)], '大文件.pdf', { type: 'application/pdf' })
    await expect(uploadPrintFile(big)).rejects.toThrow('微信发送')
  })
})

describe('resolvePrintFileUrl', () => {
  it('配了公网基址才拼得出下载链接', () => {
    expect(resolvePrintFileUrl('r2:print/2026-10/a.pdf')).toBe('https://files.example.com/print/2026-10/a.pdf')
  })
  it('负面：未配基址 ⇒ 空串（后台据此显示"未配置下载基址"，而不是拼出一个错链接）', () => {
    vi.stubEnv('VITE_R2_PUBLIC_BASE', '')
    expect(resolvePrintFileUrl('r2:print/2026-10/a.pdf')).toBe('')
  })
  it('负面：非 r2 引用原样返回空（文档 data: URL 由调用方直接用）', () => {
    expect(resolvePrintFileUrl('data:application/pdf;base64,AA')).toBe('')
  })
})
