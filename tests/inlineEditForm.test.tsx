// ProductInlineEditForm 测试（对标第五轮 E2：管理端核心写入面 1.58%→拉起）
// 重点是 payload 归一化契约：'' 不发送（防 Number('')=0 误判缺货）、
// costPrice 保留两位、stock 非法值前端拦截、创建/更新两条出口。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ updateProduct: vi.fn(), createProduct: vi.fn() }))
vi.mock('../src/auth', () => ({ updateProduct: h.updateProduct, createProduct: h.createProduct }))

import InlineEditForm from '../src/components/admin/ProductInlineEditForm'

const product = {
  _id: 'p1', name: '可乐', spec: '500ml', price: 3.5, costPrice: 2.1,
  subcategories: [], enabled: true, image: '', images: [], description: '', order: 7, stock: 5,
}

describe('ProductInlineEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.updateProduct.mockResolvedValue({ code: 0 })
    h.createProduct.mockResolvedValue({ code: 0, data: { _id: 'p_new' } })
  })

  it('编辑态回填：库存 5 显示为 "5"，留空提交不发送 stock 字段', async () => {
    render(<InlineEditForm product={product} categories={[]} onClose={() => {}} onSaved={() => {}} />)
    expect((screen.getByLabelText('库存（留空不限售）') as HTMLInputElement).value).toBe('5')
    fireEvent.change(screen.getByLabelText('库存（留空不限售）'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    await waitFor(() => expect(h.updateProduct).toHaveBeenCalled())
    const payload = h.updateProduct.mock.calls[0][1]
    expect('stock' in payload && payload.stock !== undefined).toBe(false)
  })

  it('库存非法（-5 / 小数文字）行内报错且不提交', async () => {
    render(<InlineEditForm product={product} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    const stockInput = screen.getByLabelText('库存（留空不限售）')
    fireEvent.change(stockInput, { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    expect(await screen.findByText('库存必须为整数（-1 或留空表示不限售）')).toBeTruthy()
    expect(h.updateProduct).not.toHaveBeenCalled()
    fireEvent.change(stockInput, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    await waitFor(() => expect(h.updateProduct).toHaveBeenCalled())
    expect(h.updateProduct.mock.calls[0][1].stock).toBe(12)
  })

  it('名称必填 + 成本价归一：空名报错；-2 成本被拒；3.004 存 3', async () => {
    render(<InlineEditForm product={product} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('商品名称（必填）'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    expect(await screen.findByText('商品名称不能为空')).toBeTruthy()
    const cost = screen.getByLabelText('成本价（可选）')
    fireEvent.change(cost, { target: { value: '-2' } })
    fireEvent.change(screen.getByLabelText('商品名称（必填）'), { target: { value: '可乐' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    expect(await screen.findByText('成本价必须是 ≥0 的数字')).toBeTruthy()
    fireEvent.change(cost, { target: { value: '3.004' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    await waitFor(() => expect(h.updateProduct).toHaveBeenCalled())
    expect(h.updateProduct.mock.calls[0][1].costPrice).toBe(3)
  })

  it('创建态：初始库存留空 → stock undefined；保存走 createProduct', async () => {
    render(<InlineEditForm product={{}} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('商品名称（必填）'), { target: { value: '新品' } })
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    await waitFor(() => expect(h.createProduct).toHaveBeenCalled())
    const payload = h.createProduct.mock.calls[0][0]
    expect(payload.name).toBe('新品')
    expect(payload.stock).toBeUndefined()
  })

  it('服务端拒绝：保存失败信息行进内展示（禁弹窗范式）', async () => {
    h.updateProduct.mockResolvedValue({ code: -1, message: '只读账号不能执行该操作' })
    render(<InlineEditForm product={product} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    expect(await screen.findByText(/保存失败：只读账号/)).toBeTruthy()
  })
})

describe('可选口味开关（specOptions）', () => {
  const chips = {
    _id: 'p33', name: '乐事薯片', spec: '40g', price: 2.66, costPrice: 0, subcategories: [],
    enabled: true, image: '', images: [], description: '', order: 33, stock: -1,
    specOptions: [{ label: '原味' }, { label: '黄瓜味' }, { label: '烤虾味', enabled: false }],
  }

  it('回填：关掉的口味以未按下态呈现，计数只算在显示的', () => {
    render(<InlineEditForm product={chips} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /口味 原味 当前显示/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /口味 烤虾味 当前已隐藏/ }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('2/3 个在显示')).toBeTruthy()
  })

  it('点开关只改显隐、不删数据，保存时按 enabled 一并下发', async () => {
    render(<InlineEditForm product={chips} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /口味 原味 当前显示/ }))
    expect(screen.getByRole('button', { name: /口味 原味 当前已隐藏/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /保存|确定/ }))
    await waitFor(() => expect(h.updateProduct).toHaveBeenCalled())
    expect(h.updateProduct.mock.calls[0][1].specOptions).toEqual([
      { label: '原味', enabled: false }, { label: '黄瓜味' }, { label: '烤虾味', enabled: false },
    ])
  })

  it('新增与删除口味：同名不重复添加，空白不进清单', () => {
    render(<InlineEditForm product={chips} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    const input = screen.getByLabelText('新增口味名称')
    fireEvent.change(input, { target: { value: '  青柠味  ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByRole('button', { name: /^口味 青柠味/ })).toBeTruthy()
    fireEvent.change(input, { target: { value: '青柠味' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getAllByRole('button', { name: /^口味 青柠味/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '删除口味 黄瓜味' }))
    expect(screen.queryByRole('button', { name: /^口味 黄瓜味/ })).toBeNull()
  })

  it('未配置口味的商品给出明说，而不是留一个空壳', () => {
    render(<InlineEditForm product={{ ...chips, specOptions: [] }} categories={[] as never} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('未配置口味，该商品在顾客端不出现规格选择器')).toBeTruthy()
  })
})
