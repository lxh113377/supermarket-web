// @vitest-environment jsdom
// 写评价表单 ReviewForm（七轮 H2，原覆盖 0%）：图片三道闸（张数上限/类型与大小/压缩后体积）、
// 上传失败不得静默丢评价、发布成功后必须重置表单并通知父级刷新列表。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReviewForm from '../src/components/product/ReviewForm'
import { MAX_IMAGE_DATAURL_CHARS } from '../src/utils/imageCompress'

const m = vi.hoisted(() => ({
  addReview: vi.fn(),
  compressImage: vi.fn(),
  uploadReviewImages: vi.fn(),
  onPublished: vi.fn(),
}))

vi.mock('../src/db', () => ({ addReview: m.addReview }))
vi.mock('../src/utils/reviewImages', () => ({
  compressImage: m.compressImage,
  uploadReviewImages: m.uploadReviewImages,
}))

const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(64)
const ok = { dataUrl: 'data:image/jpeg;base64,OK', blob: new Blob(['x'], { type: 'image/jpeg' }) }

function pickFiles(files: File[]) {
  const input = screen.getByLabelText('选择要上传的评价图片')
  fireEvent.change(input, { target: { files } })
}

const imgFile = (name = 'a.png', size = 1024) => {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  m.compressImage.mockResolvedValue(ok)
  m.uploadReviewImages.mockResolvedValue(['https://cdn/r1.jpg'])
  m.addReview.mockResolvedValue({ _id: 'r1' })
})
afterEach(() => { cleanup() })

describe('提交校验', () => {
  it('正文为空时发布按钮禁用（不出现"发布中"空转）', () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    expect(screen.getByRole('button', { name: '发布评价' }).hasAttribute('disabled')).toBe(true)
  })

  it('昵称为空按「匿名用户」入库，评分缺省 5 星', async () => {
    render(<ReviewForm productOrder={7} onPublished={m.onPublished} />)
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: '  好喝  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(m.addReview).toHaveBeenCalledWith(7, {
      user: '匿名用户', rating: 5, text: '好喝', images: [],
    }))
  })

  it('点 3 星后 rating=3（radiogroup + aria-checked 同步）', async () => {
    render(<ReviewForm productOrder={1} onPublished={undefined} />)
    const radio = screen.getByRole('radio', { name: '3星' })
    fireEvent.click(radio)
    expect(radio.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '5星' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(m.addReview).toHaveBeenCalledWith(1, expect.objectContaining({ rating: 3 })))
  })

  it('发布失败 → 播报服务端原因且不刷新列表', async () => {
    m.addReview.mockRejectedValue(new Error('D1 写入失败'))
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('发布失败：D1 写入失败'))
    expect(m.onPublished).not.toHaveBeenCalled()
  })

  it('成功后清空正文/昵称/评分并回调父级刷新', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    const text = screen.getByLabelText('评价内容（最多 500 字）') as HTMLTextAreaElement
    const nick = screen.getByLabelText('昵称（选填，默认匿名用户）') as HTMLInputElement
    fireEvent.change(nick, { target: { value: '小李' } })
    fireEvent.change(text, { target: { value: '很好' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('评价已发布'))
    expect(text.value).toBe('')
    expect(nick.value).toBe('')
    expect(screen.getByRole('radio', { name: '5星' }).getAttribute('aria-checked')).toBe('true')
    expect(m.onPublished).toHaveBeenCalledTimes(1)
  })
})

describe('晒图三道闸', () => {
  it('未选文件不触发压缩', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([])
    await new Promise((r) => setTimeout(r, 0))
    expect(m.compressImage).not.toHaveBeenCalled()
  })

  it('非图片与超 10MB 被过滤；混合时只压合法项并提示跳过', async () => {
    m.compressImage.mockImplementation(async () => ok)
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile('a.png'), new File(['x'], 'b.txt', { type: 'text/plain' }), imgFile('c.png', 11 * 1024 * 1024)])
    await waitFor(() => expect(m.compressImage).toHaveBeenCalledTimes(1))
    expect(screen.getByAltText('待发布图片 1')).toBeTruthy()
  })

  // 第三十七轮：预算从"2MB"收到与 D1 单语句同尺的 MAX_IMAGE_DATAURL_CHARS（90,000 字符）。
  // 夹具的边界值**由常量算出来**，不写死数字 —— 写死就会在下次改值时悄悄不再测边界。
  it('压缩后仍超单条数据预算的图被丢弃，且提示里印着是哪个预算（防"只说过大不说多大"）', async () => {
    m.compressImage.mockResolvedValue({ dataUrl: bigDataUrl.padEnd(MAX_IMAGE_DATAURL_CHARS + 10, 'B'), blob: new Blob(['x']) })
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    const status = await waitFor(() => screen.getByRole('status'))
    expect(status.textContent).toContain(String(MAX_IMAGE_DATAURL_CHARS))
    expect(status.textContent).toContain('已自动跳过')
    expect(screen.queryByAltText('待发布图片 1')).toBeNull()
  })
  it('预算内一张图被保留（正向腿：上界不是"一律丢"）', async () => {
    m.compressImage.mockResolvedValue({ dataUrl: bigDataUrl.padEnd(MAX_IMAGE_DATAURL_CHARS - 20, 'B'), blob: new Blob(['x']) })
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    await waitFor(() => expect(screen.getByAltText('待发布图片 1')).toBeTruthy())
    expect(screen.queryByRole('status')?.textContent || '').not.toContain('已自动跳过')
  })

  // 第十八轮：上限由 5 收敛成 3（服务端 reviews.js 一直是 `images.length > 3`，
  // 而前端写 5 且屏上印"最多 5 张" ⇒ 照提示选到第 4 张整条被退回）。
  // 这条用例同时改成**更强**的形态：一次给 5 张，断言只留 3 张、上传口消失、可见文案也是 3。
  it('最多 3 张：上传口文案就是 3，一次塞 5 张只留 3 张，满额后不再给上传口', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    // 先断可见文案：屏上承诺的数必须等于代码里的 cap，否则"按提示操作必然被拒"会复发
    expect(screen.getByText(/添加图片（选填，最多 3 张）/)).toBeTruthy()
    pickFiles([imgFile(), imgFile('b.png'), imgFile('c.png'), imgFile('d.png'), imgFile('e.png')])
    await waitFor(() => expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(3))
    expect(screen.queryByLabelText('选择要上传的评价图片')).toBeNull() // 满 3 张后不再给上传口
  })

  it('可逐张删除（图片与 blob 同步下标，避免错位）', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile('a.png'), imgFile('b.png')])
    await waitFor(() => expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(2))
    fireEvent.click(screen.getByLabelText('删除图片 1'))
    expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '发布评价' })) // 正文仍为空 → 禁用，不提交
    await new Promise((r) => setTimeout(r, 0))
    expect(m.addReview).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(m.addReview).toHaveBeenCalled())
    expect(m.compressImage).toHaveBeenCalledTimes(2)
  })

  it('图片处理抛错 → 提示重试而不是静默无图', async () => {
    m.compressImage.mockRejectedValue(new Error('decode'))
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('图片处理失败，请重试'))
  })

  it('上传失败时**不提交评价**（避免发出丢图的差评/好评）并给出可执行提示', async () => {
    m.uploadReviewImages.mockRejectedValueOnce(new Error('storage'))
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    await waitFor(() => expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('图片上传失败'))
    expect(m.addReview).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '发布评价' }).hasAttribute('disabled')).toBe(false)
  })

  it('有图时提交带的是上传后的 URL 数组（不是本地 dataURL）', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    await waitFor(() => expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '发布评价' }))
    await waitFor(() => expect(m.addReview).toHaveBeenCalledWith(1, expect.objectContaining({ images: ['https://cdn/r1.jpg'] })))
  })
})
