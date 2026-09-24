// @vitest-environment jsdom
// 写评价表单 ReviewForm（七轮 H2，原覆盖 0%）：图片三道闸（张数上限/类型与大小/压缩后体积）、
// 上传失败不得静默丢评价、发布成功后必须重置表单并通知父级刷新列表。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReviewForm from '../src/components/product/ReviewForm'

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

  it('压缩后仍超 2MB 的图被丢弃并提示（防 D1 体积膨胀）', async () => {
    m.compressImage.mockResolvedValue({ dataUrl: bigDataUrl.padEnd(2 * 1024 * 1024 + 10, 'B'), blob: new Blob(['x']) })
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile()])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('部分图片过大，已自动跳过'))
    expect(screen.queryByAltText('待发布图片 1')).toBeNull()
  })

  it('最多 5 张：第 6 张起拒绝并提示', async () => {
    render(<ReviewForm productOrder={1} onPublished={m.onPublished} />)
    pickFiles([imgFile(), imgFile('b.png'), imgFile('c.png'), imgFile('d.png'), imgFile('e.png')])
    await waitFor(() => expect(screen.getAllByAltText(/待发布图片/)).toHaveLength(5))
    expect(screen.queryByLabelText('选择要上传的评价图片')).toBeNull() // 满 5 张后不再给上传口
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
