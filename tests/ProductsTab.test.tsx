// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProductsTab from '../src/components/ProductsTab'
import type { Product, Category } from '../src/types'

// mock 后端写操作（测批量交互不触网）；vi.hoisted 规避 vi.mock 工厂 hoisting 到文件顶部的 TDZ 问题
const { batchUpdateProducts, batchDeleteProducts } = vi.hoisted(() => ({
  batchUpdateProducts: vi.fn(),
  batchDeleteProducts: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  updateProduct: vi.fn(),
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  batchUpdateProducts,
  batchDeleteProducts,
  adminCall: vi.fn(),
}))

const categories: Category[] = [{ _id: 'c1', name: '饮品', type: 'drink', subcategories: [] }]
const products: Product[] = [
  { _id: 'p1', name: '可乐', price: 3.5, enabled: true, order: 1 },
  { _id: 'p2', name: '薯片', price: 6, enabled: false, order: 2 },
]

describe('ProductsTab 批量操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  it('勾选商品点「上架」：调用 batchUpdateProducts 且传参正确', async () => {
    batchUpdateProducts.mockResolvedValue({ code: 0, data: { updated: 1, failed: [], total: 1 } })
    render(<ProductsTab products={products} categories={categories} onDataChange={() => {}} />)

    // 勾选第一个商品 → 批量操作栏出现
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '上架' }))

    await waitFor(() => expect(batchUpdateProducts).toHaveBeenCalledTimes(1))
    expect(batchUpdateProducts).toHaveBeenCalledWith([{ productId: 'p1', updates: { enabled: true } }])
  })

  it('批量下架：enabled 传 false', async () => {
    batchUpdateProducts.mockResolvedValue({ code: 0, data: { updated: 1, failed: [], total: 1 } })
    render(<ProductsTab products={products} categories={categories} onDataChange={() => {}} />)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '下架' }))

    await waitFor(() => expect(batchUpdateProducts).toHaveBeenCalledTimes(1))
    expect(batchUpdateProducts).toHaveBeenCalledWith([{ productId: 'p1', updates: { enabled: false } }])
  })

  it('批量删除：调用 batchDeleteProducts 且不带上架分支', async () => {
    batchDeleteProducts.mockResolvedValue({ code: 0, data: { deleted: 1, failed: [], total: 1 } })
    render(<ProductsTab products={products} categories={categories} onDataChange={() => {}} />)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(batchDeleteProducts).toHaveBeenCalledTimes(1))
    expect(batchDeleteProducts).toHaveBeenCalledWith(['p1'])
    expect(batchUpdateProducts).not.toHaveBeenCalled()
  })

  it('批量部分失败：内联反馈条展示失败明细（2026-09-23 第三轮优化：alert→notice，不再阻塞）', async () => {
    batchUpdateProducts.mockResolvedValue({ code: 0, data: { updated: 0, failed: [{ id: 'p1', message: '商品不存在' }], total: 1 } })
    render(<ProductsTab products={products} categories={categories} onDataChange={() => {}} />)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '上架' }))

    // 注：本仓无 @testing-library/jest-dom 依赖，toHaveTextContent 不可用，
    // 用原生 textContent + Chai toContain 断言（全仓其他测试同口径）
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('批量上架部分失败：1/1 未生效'))
    expect(globalThis.alert).not.toHaveBeenCalled()
  })
})
