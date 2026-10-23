// 顾客端打印表单（`type:'file'` 字段分支）的行为测试（2026-10-23 随 5106dac 立项）。
//
// 为什么必须有：这条分支是顾客端（lxh113377.github.io，纯静态托管）唯一的打印下单入口 ——
// 搬进来的校园打印应用依赖同源 /api，而 GitHub Pages 跑不了 Pages Functions，那条路在顾客端
// 只剩「无法读取服务配置」的死页。这段坏了 = 顾客下不了单。它落地时 0 测试的直接后果是
// 覆盖率棘轮掉线（CI job 120281269819：Statements 78.64% < 79%、Branches 71.73% < 72%）。
// 但本文件不是「为覆盖率凑测试」：下面钉的是四类真实失败（超数量、窄名单外的类型、上传
// 抛错、内联降级）加上提交体形状（后台靠 serviceId 认单、靠 images 取件）。
//
// 打桩边界：只 mock「网络与云」，表单逻辑本身真跑。
// - printUpload 必须 mock：真实现会 fetch /upload，jsdom 没有这条路由；要判的是表单拿到引用
//   之后做了什么，不是它怎么拿到。
// - businessHours 必须钉成「营业中」：ServiceFormPage 顶部 `open = isBusinessHours()` 按真实
//   时钟判定，不 mock 会让本文件白天绿、打烊时段红 ⇒ 不稳定夹具，与代码对错无关。
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const h = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  uploadPrintFile: vi.fn(),
  isBusinessHours: vi.fn(() => true),
}))

vi.mock('../src/db', () => ({ createSubmission: h.createSubmission }))
vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: h.isBusinessHours,
  getClosedMessage: () => '营业时间 09:00-21:00',
}))
vi.mock('../src/utils/printUpload', () => ({
  uploadPrintFile: h.uploadPrintFile,
  resolvePrintFileUrl: vi.fn(() => ''),
}))

import ServiceFormPage from '../src/pages/ServiceFormPage'
import { MAX_PRINT_FILES } from '../src/pages/print/print.config'

// 隐藏文件 input 的可访问名 = `上传${field.label}`；a11y 关联刻意落在**可见按钮**上
//（隐藏 input 读屏不念，第十五轮立的规矩），所以取错误状态要找按钮、不是找 input。
const fileInput = () => screen.getByLabelText('上传要打印的文件') as HTMLInputElement
const trigger = () => screen.getByRole('button', { name: /点击选择要打印的文件/ })

// ServiceFormPage 顶部就调 useNavigate（提交成功要 navigate 走），所以必须给它真实的
// Router 上下文；裸 render 会让 8 条用例一起死于 invariant 而不是死于断言。
// 路径也走真路由表：useParams().serviceId 要靠它解析出 print 服务。
const renderForm = () =>
  render(
    <MemoryRouter initialEntries={['/service/print']}>
      <Routes>
        <Route path="/service/:serviceId" element={<ServiceFormPage />} />
      </Routes>
    </MemoryRouter>,
  )

const mkFile = (name: string, type = 'application/pdf', bytes = 1024) => {
  const f = new File(['x'.repeat(bytes)], name, { type })
  Object.defineProperty(f, 'name', { value: name })
  return f
}

const pick = (...fs: File[]) => fireEvent.change(fileInput(), { target: { files: fs } })

// required 字段的可访问名里带 `*`（label 内那个 aria-hidden 的星号 span）⇒
// 按精确字符串 '微信号' 取不到 '微信号*'，一律用正则。
const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label) as HTMLInputElement, { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  h.isBusinessHours.mockReturnValue(true)
  h.createSubmission.mockResolvedValue({ id: 's_test' })
  h.uploadPrintFile.mockImplementation(async (f: File) => ({
    ref: 'r2:print/2026-10/' + f.name,
    name: f.name,
    size: f.size,
    inline: false,
  }))
})

describe('打印表单：准入按服务端真函数收的那份窄名单，不等服务端拒', () => {
  it('选 PDF ⇒ 发上传请求，chip 显示真实文件名而不是 r2 key', async () => {
    renderForm()
    pick(mkFile('高数期中.pdf'))
    await waitFor(() => expect(h.uploadPrintFile).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/高数期中\.pdf/)).toBeTruthy()
    expect(screen.queryByText(/r2:print/), '顾客不该在界面上看到内部 key').toBeNull()
  })

  it('PPT（宽名单在册、内联准入之外）当场拦下并点名文件，一个都不上传', async () => {
    renderForm()
    pick(mkFile('课件.ppt', 'application/vnd.ms-powerpoint'))
    expect(await screen.findByText(/课件\.ppt/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('类型暂不支持')
    expect(h.uploadPrintFile).not.toHaveBeenCalled()
    expect(trigger().getAttribute('aria-invalid'), '类型错误要关联到可见按钮').toBe('true')
    expect(fileInput().hasAttribute('aria-invalid'), '关联不该挂在隐藏 input 上').toBe(false)
  })

  it('超过上限：拒绝并点名张数，不发任何上传（不留「收了一半」的中间态）', async () => {
    renderForm()
    const many = Array.from({ length: MAX_PRINT_FILES + 1 }, (_, i) => mkFile('f' + i + '.pdf'))
    pick(...many)
    expect(await screen.findByText(new RegExp('最多上传' + MAX_PRINT_FILES + '个文件'))).toBeTruthy()
    expect(h.uploadPrintFile).not.toHaveBeenCalled()
  })

  it('上传抛错 ⇒ 原因原样显示并清空 input（同一个文件重选要还能触发 change）', async () => {
    h.uploadPrintFile.mockRejectedValueOnce(new Error('文件过大且云存储未就绪'))
    renderForm()
    pick(mkFile('big.pdf'))
    expect(await screen.findByText(/文件过大且云存储未就绪/)).toBeTruthy()
    expect(fileInput().value).toBe('')
  })
})

describe('打印表单：内联降级是「提示」不是「错误」（本轮新增的分轨）', () => {
  it('走内联时提示进 role=status，role=alert 的错误框必须是空的', async () => {
    h.uploadPrintFile.mockResolvedValueOnce({
      ref: 'data:application/pdf;base64,AAAA', name: '小抄.pdf', size: 512, inline: true,
    })
    renderForm()
    pick(mkFile('小抄.pdf'))
    // 提示文案刻意**不含**「以内联方式提交」—— 那几个字是每个文件 chip 上的状态标签
    //（`以内联方式提交（未走云存储）`，被按文本断言）。两处都写会让该文案在页面上出现
    // 两次，任何按文本查的用例都会因「找到多个元素」而红。提示轨讲下一步怎么做，
    // chip 讲这个文件现在什么状态，各司其职。
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('未走云存储'))
    expect(screen.getByRole('alert').textContent, '内联是成功路径，不该染色成错误').toBe('')
  })

  it('删掉最后一个文件 ⇒ 提示一起消失（不留与新状态并存的旧提示）', async () => {
    h.uploadPrintFile.mockResolvedValueOnce({
      ref: 'data:application/pdf;base64,AAAA', name: 'x.pdf', size: 400, inline: true,
    })
    renderForm()
    pick(mkFile('x.pdf'))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('删除文件 x.pdf'))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

describe('打印表单：提交体形状（后台靠它认服务与文件）', () => {
  it('没传文件就提交 ⇒ 拦在文件字段上，不发请求', async () => {
    renderForm()
    fill(/微信号/, 'wx_abc')
    fill(/送达楼栋/, '36栋 1520')
    fireEvent.click(screen.getByRole('button', { name: /提交信息/ }))
    expect(await screen.findByText(/请上传要打印的文件/)).toBeTruthy()
    expect(h.createSubmission).not.toHaveBeenCalled()
  })

  it('填全后提交 ⇒ serviceId=print、文件引用落在 images、进入成功页', async () => {
    renderForm()
    fill(/微信号/, 'wx_abc')
    fill(/送达楼栋/, '36栋 1520')
    pick(mkFile('论文.pdf'))
    await waitFor(() => expect(h.uploadPrintFile).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /提交信息/ }))
    await waitFor(() => expect(h.createSubmission).toHaveBeenCalledTimes(1))
    const sent = h.createSubmission.mock.calls[0][0] as Record<string, unknown>
    expect(sent.serviceId).toBe('print')
    expect(sent.serviceName).toBe('打印')
    expect(sent.images, '文件引用必须进 images：与图片型共用同一字段，后台按它取件').toEqual([
      'r2:print/2026-10/论文.pdf',
    ])
    expect((sent.formData as Record<string, string>).building).toBe('36栋 1520')
    expect(await screen.findByText('提交成功')).toBeTruthy()
  })
})
