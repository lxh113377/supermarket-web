// ReviewsTab / SubmissionsTab 组件测试（对标第四轮 D1：管理端两 Tab 从 0% 拉起）
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  getAllReviews: vi.fn(),
  addCloudReview: vi.fn(),
  deleteCloudReview: vi.fn(),
  getAdminProducts: vi.fn(),
  adminCall: vi.fn(),
}))

vi.mock('../src/db', () => ({
  getAllReviews: h.getAllReviews,
  addCloudReview: h.addCloudReview,
  deleteCloudReview: h.deleteCloudReview,
  getAdminProducts: h.getAdminProducts,
}))
vi.mock('../src/auth', () => ({ adminCall: h.adminCall }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: true }))

import ReviewsTab from '../src/components/ReviewsTab'
import SubmissionsTab from '../src/components/SubmissionsTab'

const reviews = [
  { _id: 'r1', productOrder: 33, user: '小明', rating: 5, text: '好喝', images: [], createdAt: '2026-09-24T00:00:00Z' },
]
const products = [{ _id: 'p1', name: '乐事薯片', order: 33, price: 5.5, enabled: true }]
const subs = [
  { _id: 's1', serviceId: '开锁', serviceName: '开锁', formData: { 描述: '门反锁了' }, imageCount: 2, status: 'pending', createdAt: '2026-09-24T01:00:00Z' },
]

describe('ReviewsTab 评价管理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getAllReviews.mockResolvedValue(reviews)
    h.getAdminProducts.mockResolvedValue(products)
    h.deleteCloudReview.mockResolvedValue({ code: 0 })
  })

  it('加载后渲染评价行与星级可访问名', async () => {
    render(<ReviewsTab />)
    expect(await screen.findByText('小明')).toBeTruthy()
    expect(screen.getByRole('img', { name: '5 星（满分 5 星）' })).toBeTruthy()
    expect(screen.getByText('好喝')).toBeTruthy()
  })

  it('空列表合法：显示空态而非报错', async () => {
    h.getAllReviews.mockResolvedValue([])
    render(<ReviewsTab />)
    expect(await screen.findByText('暂无云端评价')).toBeTruthy()
  })

  it('新增表单：未选商品提交给出行内错误；成功路径刷新列表', async () => {
    render(<ReviewsTab />)
    fireEvent.click(await screen.findByRole('button', { name: '+ 新增评价' }))
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    expect(await screen.findByText('请选择商品')).toBeTruthy()
    h.addCloudReview.mockResolvedValue({ _id: 'r2', productOrder: 33, user: '管理员', rating: 5, text: '不错', images: [], createdAt: '2026-09-24T02:00:00Z' })
    // option value 是商品 order（非 _id）：33
    fireEvent.change(screen.getByLabelText('选择商品'), { target: { value: '33' } })
    fireEvent.change(screen.getByLabelText(/评价内容/), { target: { value: '不错' } })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    await waitFor(() => expect(h.addCloudReview).toHaveBeenCalledWith(33, expect.objectContaining({ text: '不错' })))
    // 成功路径：表单收起 + 新评价本地前插（组件不回拉列表， getAllReviews 保持 1 次）
    await waitFor(() => expect(screen.queryByRole('button', { name: '发布' })).toBeNull())
    expect(await screen.findByText('不错')).toBeTruthy()
  })

  it('删除：confirm 后走 deleteCloudReview 并重拉', async () => {
    vi.stubGlobal('confirm', () => true)
    render(<ReviewsTab />)
    const del = await screen.findByRole('button', { name: '删除' })
    fireEvent.click(del)
    await waitFor(() => expect(h.deleteCloudReview).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
})

describe('SubmissionsTab 服务提交', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.adminCall.mockResolvedValue({ code: 0, data: subs })
  })

  it('渲染待处理徽标与分类筛选组', async () => {
    render(<SubmissionsTab />)
    expect(await screen.findByText('开锁')).toBeTruthy()
    expect(screen.getByText('待处理')).toBeTruthy()
    expect(screen.getByRole('group', { name: '按服务分类筛选' })).toBeTruthy()
  })

  it('展开图片区：按需拉 getSubmissionImages 并显示图片', async () => {
    h.adminCall.mockImplementation(async (action: string) => {
      if (action === 'getSubmissionImages') return { code: 0, data: { images: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] } }
      return { code: 0, data: subs }
    })
    render(<SubmissionsTab />)
    fireEvent.click(await screen.findByRole('button', { name: /查看图片/ }))
    await waitFor(() => expect(h.adminCall).toHaveBeenCalledWith('getSubmissionImages', { submissionId: 's1' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /查看截图/ }).length).toBe(2))
  })

  it('状态处理：updateSubmissionStatus 后刷新', async () => {
    h.adminCall.mockImplementation(async (action: string) => {
      if (action === 'updateSubmissionStatus') return { code: 0 }
      return { code: 0, data: subs }
    })
    render(<SubmissionsTab />)
    const btn = await screen.findByRole('button', { name: /标记已处理|已处理/ })
    fireEvent.click(btn)
    await waitFor(() => expect(h.adminCall).toHaveBeenCalledWith('updateSubmissionStatus', expect.objectContaining({ submissionId: 's1' })))
  })
})
