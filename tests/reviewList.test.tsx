// @vitest-environment jsdom
// 评价列表 ReviewList / Stars / 评价图子件（七轮 H2，原覆盖 0%）
// 锁三件事：日期三态取法（date / createdAt / 都无效）、图片解析失败与加载失败都要有占位而不是破图、
// 空列表与排序回调（排序本身在父页做，这里只回调）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReviewList, { Stars } from '../src/components/product/ReviewList'
import type { Review } from '../src/types'

const m = vi.hoisted(() => ({ resolveReviewImages: vi.fn() }))
vi.mock('../src/utils/reviewImages', () => ({ resolveReviewImages: m.resolveReviewImages }))

const rv = (over: Partial<Review> = {}): Review => ({
  user: '张三', rating: 5, text: '好喝', productOrder: 1, ...over,
} as unknown as Review)

beforeEach(() => {
  m.resolveReviewImages.mockImplementation(async (imgs: string[]) => imgs)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Stars', () => {
  it('实心星数=评分、空星补齐 5 位，并给读屏 aria-label', () => {
    render(<Stars rating={3} />)
    expect(screen.getByLabelText('3 星').textContent).toBe('★★★☆☆')
  })

  it('0 分不出现负数 repeat（☆ 满 5）', () => {
    render(<Stars rating={0} />)
    expect(screen.getByLabelText('0 星').textContent).toBe('☆☆☆☆☆')
  })
})

describe('列表与空态', () => {
  it('空列表给"抢沙发"引导而不是空白卡片', () => {
    render(<ReviewList reviews={[]} sort="newest" onSortChange={vi.fn()} />)
    expect(screen.getByText('买家评价 (0)')).toBeTruthy()
    expect(screen.getByText('暂无评价，快来抢沙发~')).toBeTruthy()
  })

  it('排序三档按钮回调正确值', () => {
    const onSort = vi.fn()
    render(<ReviewList reviews={[rv()]} sort="newest" onSortChange={onSort} />)
    fireEvent.click(screen.getByText('高分'))
    expect(onSort).toHaveBeenCalledWith('highest')
    fireEvent.click(screen.getByText('低分'))
    expect(onSort).toHaveBeenCalledWith('lowest')
    fireEvent.click(screen.getByText('最新'))
    expect(onSort).toHaveBeenLastCalledWith('newest')
  })

  it('评价正文/昵称/星级逐条渲染（多条不串内容）', () => {
    render(<ReviewList reviews={[rv({ user: '甲', text: '第一条' }), rv({ user: '乙', rating: 2, text: '第二条' })]} sort="newest" onSortChange={vi.fn()} />)
    expect(screen.getByText('甲')).toBeTruthy()
    expect(screen.getByText('乙')).toBeTruthy()
    expect(screen.getByText('第二条')).toBeTruthy()
    expect(screen.getByLabelText('2 星')).toBeTruthy()
  })
})

describe('日期取法', () => {
  it('优先用 date 字段（种子数据只有 date）', () => {
    render(<ReviewList reviews={[rv({ date: '2026-09-01' })]} sort="newest" onSortChange={vi.fn()} />)
    expect(screen.getByText('2026-09-01')).toBeTruthy()
  })

  it('无 date 时按 createdAt 转 ISO 日期', () => {
    render(<ReviewList reviews={[rv({ createdAt: '2026-09-02T23:30:00Z' })]} sort="newest" onSortChange={vi.fn()} />)
    expect(screen.getByText('2026-09-02')).toBeTruthy()
  })

  it('createdAt 不可解析也不崩（返回空串）', () => {
    render(<ReviewList reviews={[rv({ createdAt: 'not-a-date' })]} sort="newest" onSortChange={vi.fn()} />)
    expect(screen.getByText('好喝')).toBeTruthy()
  })
})

describe('评价晒图', () => {
  it('fileID/URL 异步解析成功后渲染图片', async () => {
    m.resolveReviewImages.mockResolvedValueOnce(['https://cdn/r1.webp'])
    const { container } = render(<ReviewList reviews={[rv({ images: ['cloud://r1'] })]} sort="newest" onSortChange={vi.fn()} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn/r1.webp'))
    expect(m.resolveReviewImages).toHaveBeenCalledWith(['cloud://r1'])
  })

  it('最多只渲染 5 张（服务端 REVIEW 图片上限一致）', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    const { container } = render(<ReviewList reviews={[rv({ images: six })]} sort="newest" onSortChange={vi.fn()} />)
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(5))
    expect(m.resolveReviewImages).toHaveBeenCalledWith(['a', 'b', 'c', 'd', 'e'])
  })

  it('图片加载失败 → 该格换占位图，其余不受影响', async () => {
    const { container } = render(<ReviewList reviews={[rv({ images: ['x1', 'x2'] })]} sort="newest" onSortChange={vi.fn()} />)
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2))
    fireEvent.error(container.querySelectorAll('img')[0])
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelectorAll('img')[0].getAttribute('alt')).toBe('评价图片 2')
  })

  it('解析抛错时保留原值继续渲染（不因解析失败丢图）', async () => {
    m.resolveReviewImages.mockRejectedValueOnce(new Error('resolve fail'))
    const { container } = render(<ReviewList reviews={[rv({ images: ['/images/1.webp'] })]} sort="newest" onSortChange={vi.fn()} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/1.webp'))
  })

  it('images 非数组/为空时不渲染图片区', () => {
    const { container } = render(<ReviewList reviews={[rv({ images: undefined }), rv({ images: [] })]} sort="newest" onSortChange={vi.fn()} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
