// useShopFilters：商城筛选态以 URL 为唯一真相（阶段一新增，覆盖归一与写回两条路径）
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useShopFilters, normalizeSort, shopPath, SORT_OPTIONS } from '../src/hooks/useShopFilters'
import type { Category } from '../src/types'

const cats: Category[] = [
  {
    _id: 'drinks', name: '饮品', type: 'drink', order: 1,
    subcategories: [{ id: 'sweet', name: '甜口' }, { id: 'water', name: '矿泉水' }],
  },
  {
    _id: 'food', name: '食品', type: 'food', order: 2,
    subcategories: [{ id: 'snacks', name: '零食' }],
  },
]

function Loc() {
  const l = useLocation()
  return <span data-testid="loc">{l.pathname + l.search}</span>
}

function Probe({ list = cats }: { list?: Category[] }) {
  const f = useShopFilters(list)
  return (
    <div>
      <span data-testid="cat">{f.category?._id ?? 'none'}</span>
      <span data-testid="sub">{f.subId}</span>
      <span data-testid="q">{f.q}</span>
      <span data-testid="sort">{f.sort}</span>
      <button onClick={() => f.selectCategory('food')}>cat</button>
      <button onClick={() => f.selectSub('snacks')}>sub</button>
      <button onClick={() => f.setQuery('可乐')}>query</button>
      <button onClick={() => f.setSortBy('price-desc')}>sort</button>
      <button onClick={() => f.setSortBy('garbage')}>badsort</button>
    </div>
  )
}

function renderProbe(path: string, list?: Category[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Loc />
      <Routes>
        <Route path="/shop/:categoryId?/:subId?" element={<Probe list={list} />} />
      </Routes>
    </MemoryRouter>,
  )
}

const val = (id: string) => screen.getByTestId(id).textContent

describe('normalizeSort / shopPath 纯函数', () => {
  it('只认白名单里的排序值，其余一律归零为 default', () => {
    expect(normalizeSort('price-asc')).toBe('price-asc')
    expect(normalizeSort('price-desc')).toBe('price-desc')
    expect(normalizeSort('default')).toBe('default')
    expect(normalizeSort('bogus')).toBe('default')
    expect(normalizeSort('')).toBe('default')
    expect(normalizeSort(null)).toBe('default')
    expect(normalizeSort(undefined)).toBe('default')
  })

  it('子分类为空不进路径，避免尾斜杠地址', () => {
    expect(shopPath('food')).toBe('/shop/food')
    expect(shopPath('food', '')).toBe('/shop/food')
    expect(shopPath('food', 'snacks')).toBe('/shop/food/snacks')
  })

  it('排序选项表本身就是 default + 两个价格向，标签与键一一对应', () => {
    expect(SORT_OPTIONS.map((o) => o.key)).toEqual(['default', 'price-asc', 'price-desc'])
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['默认', '价格↑', '价格↓'])
  })
})

describe('useShopFilters 读取与归一', () => {
  it('无参数时落到第一个分类、全部子类、空搜索、默认排序', () => {
    renderProbe('/shop')
    expect(val('cat')).toBe('drinks')
    expect(val('sub')).toBe('')
    expect(val('q')).toBe('')
    expect(val('sort')).toBe('default')
  })

  it('路径参数命中真实分类与子类', () => {
    renderProbe('/shop/food/snacks')
    expect(val('cat')).toBe('food')
    expect(val('sub')).toBe('snacks')
  })

  it('未知分类回落第一个分类（不渲染骗人的空列表）', () => {
    renderProbe('/shop/nope')
    expect(val('cat')).toBe('drinks')
  })

  it('子类不属于当前分类时按「全部」处理', () => {
    renderProbe('/shop/drinks/snacks')
    expect(val('cat')).toBe('drinks')
    expect(val('sub')).toBe('')
  })

  it('目录还没到达时分类为 null，写操作不炸', () => {
    renderProbe('/shop/food/snacks', [])
    expect(val('cat')).toBe('none')
    expect(val('sub')).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'sub' }))
    fireEvent.click(screen.getByRole('button', { name: 'query' }))
    fireEvent.click(screen.getByRole('button', { name: 'sort' }))
    // 无分类可拼路径，地址保持原样
    expect(val('loc')).toBe('/shop/food/snacks')
  })

  it('q 从 query 读取并解码中文', () => {
    renderProbe('/shop/drinks?q=%E5%8F%AF%E4%B9%90&sort=price-asc')
    expect(val('q')).toBe('可乐')
    expect(val('sort')).toBe('price-asc')
  })

  it('非法 sort 归零为 default', () => {
    renderProbe('/shop/drinks?sort=bogus')
    expect(val('sort')).toBe('default')
  })
})

describe('useShopFilters 写回 URL', () => {
  it('切分类保留当前搜索与排序，只换路径段', () => {
    renderProbe('/shop/drinks?q=%E5%8F%AF%E4%B9%90&sort=price-desc')
    fireEvent.click(screen.getByRole('button', { name: 'cat' }))
    expect(val('loc')).toBe('/shop/food?q=%E5%8F%AF%E4%B9%90&sort=price-desc')
  })

  it('切子类写进路径段', () => {
    renderProbe('/shop/food')
    fireEvent.click(screen.getByRole('button', { name: 'sub' }))
    expect(val('loc')).toBe('/shop/food/snacks')
  })

  it('写搜索用 query 承载，默认排序不占 URL', () => {
    renderProbe('/shop/drinks')
    fireEvent.click(screen.getByRole('button', { name: 'query' }))
    expect(val('loc')).toBe('/shop/drinks?q=%E5%8F%AF%E4%B9%90')
  })

  it('排序为 default 时把 sort 参数整个摘掉，不留 sort=default 噪声', () => {
    renderProbe('/shop/drinks?sort=price-asc')
    fireEvent.click(screen.getByRole('button', { name: 'badsort' }))
    expect(val('loc')).toBe('/shop/drinks')
    expect(val('sort')).toBe('default')
  })

  it('设置合法排序写回 query', () => {
    renderProbe('/shop/drinks')
    fireEvent.click(screen.getByRole('button', { name: 'sort' }))
    expect(val('loc')).toBe('/shop/drinks?sort=price-desc')
    expect(val('sort')).toBe('price-desc')
  })
})
