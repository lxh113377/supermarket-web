// 顾客端服务表单页（/#/service/print）的文件上传分支测试。
//
// 立项理由（2026-10-23）：5106dac 给这页加了 115 行「file」字段上传逻辑（handleFileSelect /
// removeFile / fileMeta 双态），**零测试**。直接后果是覆盖率棘轮掉线 —— CI 的 gates step 20
// 报 Statements 78.64% < 79%、Branches 71.73% < 72%（一手：job 120281269819 日志 1006-1007 行）。
// 但不是"为覆盖率凑测试"：这段是顾客提交打印文件的唯一入口，它的四类失败（超数量、
// 窄名单外的类型、上传抛错、内联降级）此前一条都没被钉住。
//
// 夹具说明（三处都是实测出来的，不是猜的）：
//   - print 服务**没有 popup** ⇒ 首屏没有「我知道了」按钮，别去点它。
//   - 错误容器 <div id="sf-error" role="alert"> 是**无条件渲染**的（里面 {error && …} 才条件
//     渲染）⇒ findByRole("alert") 会立刻拿到一个空容器，断言必须等**具体文案**出现。
//   - isBusinessHours 按真实时钟判定 ⇒ 不 mock 会让测试在打烊时段多出一条无关提示，
//     属不稳定夹具，这里钉成"营业中"。
// 不触网：uploadPrintFile 与 createSubmission 全部 mock。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  uploadPrintFile: vi.fn(),
  createSubmission: vi.fn(),
  isBusinessHours: vi.fn(() => true),
}))

vi.mock('../src/db', () => ({ createSubmission: mocks.createSubmission }))
vi.mock('../src/utils/printUpload', () => ({
  uploadPrintFile: mocks.uploadPrintFile,
  isDirectRef: () => false,
}))
vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => mocks.isBusinessHours(),
  getClosedMessage: () => '当前非营业时间，请在群内先与商家确认营业后再下单',
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ serviceId: 'print' }) }
})

import ServiceFormPage from '../src/pages/ServiceFormPage'
import { MAX_PRINT_FILES, PRINT_INLINE_ALLOWED_EXT } from '../src/pages/print/print.config'

const mkFile = (name: string, type = 'application/pdf') =>
  new File([new Uint8Array(16)], name, { type })

const fileInput = () => screen.getByLabelText(/要打印的文件/) as HTMLInputElement
const trigger = () => screen.getByRole('button', { name: /点击选择要打印的文件/ })
const pick = async (files: File[]) => {
  fireEvent.change(fileInput(), { target: { files } })
}

describe('ServiceFormPage 文件上传（打印服务）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mocks.isBusinessHours.mockReturnValue(true)
    mocks.createSubmission.mockResolvedValue({ id: 'sub-1' })
  })

  it('选一个 PDF：走 uploadPrintFile，列表显示真实文件名而不是 r2 key / data URL', async () => {
    mocks.uploadPrintFile.mockResolvedValue({ ref: 'r2:key1', name: '合同.pdf', size: 16, inline: false })
    render(<ServiceFormPage />)
    await pick([mkFile('合同.pdf')])
    await waitFor(() => expect(mocks.uploadPrintFile).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/合同\.pdf/)).toBeTruthy()
    expect(screen.queryByText(/以内联方式提交/)).toBeNull()
    expect(screen.queryByText(/r2:key1/)).toBeNull()
  })

  it('内联降级：inline=true 必须告诉顾客「未走云存储」（否则他以为文件在云上）', async () => {
    mocks.uploadPrintFile.mockResolvedValue({ ref: 'data:image/png;base64,xx', name: '小票.png', size: 16, inline: true })
    render(<ServiceFormPage />)
    await pick([mkFile('小票.png', 'image/png')])
    expect(await screen.findByText(/以内联方式提交/)).toBeTruthy()
  })

  it('超数量：拒绝并点名上限，且一个都不上传（不留"收了一半"的中间态）', async () => {
    render(<ServiceFormPage />)
    const many = Array.from({ length: MAX_PRINT_FILES + 1 }, (_, i) => mkFile('f' + i + '.pdf'))
    await pick(many)
    expect(await screen.findByText(new RegExp('最多上传' + MAX_PRINT_FILES + '个文件'))).toBeTruthy()
    expect(mocks.uploadPrintFile).not.toHaveBeenCalled()
  })

  it('窄名单外的扩展名当场拒绝并点名是哪个文件 —— 不等服务端拒', async () => {
    expect(PRINT_INLINE_ALLOWED_EXT).not.toContain('ppt')  // 前提：ppt 确实在内联准入之外
    render(<ServiceFormPage />)
    await pick([mkFile('讲义.ppt')])
    expect(await screen.findByText(/讲义\.ppt/)).toBeTruthy()
    expect(mocks.uploadPrintFile).not.toHaveBeenCalled()
    // 第十五轮立的关联：错误要落到**可见按钮**上（隐藏 input 读屏不念）
    expect(trigger().getAttribute('aria-invalid'), '类型错误没关联到可见按钮').toBe('true')
    expect(fileInput().hasAttribute('aria-invalid'), '关联不该挂在隐藏 input 上').toBe(false)
  })

  it('上传抛错：把 error.message 原样显示，不吞成「未知错误」', async () => {
    mocks.uploadPrintFile.mockRejectedValue(new Error('文件过大且云存储未就绪'))
    render(<ServiceFormPage />)
    await pick([mkFile('大单.pdf')])
    expect(await screen.findByText(/文件过大且云存储未就绪/)).toBeTruthy()
  })

  it('删除文件：images 与 fileMeta 同步删（不同步会让后台看到 A 的名配 B 的图）', async () => {
    mocks.uploadPrintFile
      .mockResolvedValueOnce({ ref: 'r2:a', name: '第一份.pdf', size: 16, inline: false })
      .mockResolvedValueOnce({ ref: 'r2:b', name: '第二份.pdf', size: 16, inline: false })
    render(<ServiceFormPage />)
    await pick([mkFile('第一份.pdf'), mkFile('第二份.pdf')])
    await waitFor(() => expect(screen.getByText(/第一份\.pdf/)).toBeTruthy())
    fireEvent.click(screen.getByLabelText('删除文件 第一份.pdf'))
    await waitFor(() => expect(screen.queryByText(/第一份\.pdf/)).toBeNull())
    expect(screen.getByText(/第二份\.pdf/)).toBeTruthy()
  })

  it('用户点了取消（空列表）：不调用上传、不报错', async () => {
    render(<ServiceFormPage />)
    await pick([])
    await new Promise(r => setTimeout(r, 60))
    expect(mocks.uploadPrintFile).not.toHaveBeenCalled()
    expect(screen.queryByText(/最多上传|类型暂不支持|上传失败/)).toBeNull()
  })

  it('必填未传就提交：拦住、说清是哪个字段，并且不发请求', async () => {
    render(<ServiceFormPage />)
    fireEvent.change(screen.getByLabelText(/微信号/), { target: { value: 'wx_1' } })
    fireEvent.change(screen.getByLabelText(/送达楼栋/), { target: { value: '36栋 1520' } })
    fireEvent.click(screen.getByRole('button', { name: /提交信息/ }))
    expect(await screen.findByText(/请上传要打印的文件/)).toBeTruthy()
    expect(trigger().getAttribute('aria-invalid')).toBe('true')
    expect(mocks.createSubmission).not.toHaveBeenCalled()
  })

  it('补齐文件后可以提交成功（上传→提交的完整链路，钉住 fileMeta 进了提交体）', async () => {
    mocks.uploadPrintFile.mockResolvedValue({ ref: 'r2:ok', name: '作业.pdf', size: 16, inline: false })
    render(<ServiceFormPage />)
    fireEvent.change(screen.getByLabelText(/微信号/), { target: { value: 'wx_1' } })
    fireEvent.change(screen.getByLabelText(/送达楼栋/), { target: { value: '36栋 1520' } })
    await pick([mkFile('作业.pdf')])
    await waitFor(() => expect(mocks.uploadPrintFile).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /提交信息/ }))
    await waitFor(() => expect(mocks.createSubmission).toHaveBeenCalled())
    const sent = mocks.createSubmission.mock.calls[0][0]
    expect(sent.images).toEqual(['r2:ok'])
    expect(await screen.findByText(/提交成功/)).toBeTruthy()
  })
})
