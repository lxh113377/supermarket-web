// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import BrandMark from '../src/components/brand/BrandMark'
import CustomerHeader from '../src/components/brand/CustomerHeader'
import WorkspaceShell from '../src/components/brand/WorkspaceShell'

vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => true,
}))

describe('视觉分支：品牌与顾客导航', () => {
  it('保留校园平台名与超市识别，不替换业务品牌', () => {
    const { container } = render(<MemoryRouter><BrandMark /></MemoryRouter>)
    expect(screen.getByText('江科一站通')).toBeTruthy()
    expect(screen.getByText('超柿')).toBeTruthy()
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/')
  })

  it('购物和订单查询是原生链接，AI 导购是独立入口', () => {
    render(<MemoryRouter><CustomerHeader /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '去逛超市' }).getAttribute('href')).toBe('/shop')
    expect(screen.getByRole('link', { name: '查询订单' }).getAttribute('href')).toBe('/order-query')
    expect(screen.getByRole('link', { name: '打开 AI 导购' }).getAttribute('href')).toBe('/assistant')
  })
})

const tabs = [
  { key: 'dashboard', label: '看板', icon: 'chart' },
  { key: 'products', label: '商品', icon: 'box' },
  { key: 'orders', label: '订单', icon: 'receipt' },
  { key: 'submissions', label: '服务', icon: 'service' },
  { key: 'reviews', label: '评价', icon: 'star' },
] as const

function WorkspaceFixture() {
  const [tab, setTab] = useState('products')
  return <MemoryRouter><WorkspaceShell tab={tab} tabs={tabs} onTabChange={setTab} title="商品管理" description="管理真实商品与上架状态。">
    <div role="tabpanel" id="admin-panel-products" aria-labelledby="admin-tab-products"><p>商品工作区</p></div>
  </WorkspaceShell></MemoryRouter>
}

describe('视觉分支：经营工作台', () => {
  it('只保留一组可访问的 tablist 与 tabpanel', () => {
    const { container } = render(<WorkspaceFixture />)
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '商品管理' })).toBeTruthy()
    expect(screen.getByText('商品工作区')).toBeTruthy()
    expect(container.querySelector('[role="tabpanel"]')?.id).toBe('admin-panel-products')
  })

  it('点击与左右方向键切换页签，并恢复 roving tabindex', () => {
    render(<WorkspaceFixture />)
    fireEvent.click(screen.getByRole('tab', { name: '订单' }))
    expect(screen.getByRole('tab', { name: '订单' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '服务' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '商品' }).tabIndex).toBe(-1)
  })
})
