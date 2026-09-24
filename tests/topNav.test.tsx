// TopNav 受控化测试（阶段一：此前 TopNav 零覆盖，改受控 props 必须先把行为钉住）
// 覆盖：空目录出骨架而非消失、大类/子类 aria-pressed、切大类先清子类、搜索按钮态。
import { describe, it, expect, vi } from 'vitest'
import { type ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import TopNav from '../src/components/TopNav'
import type { Category } from '../src/types'

const cats: Category[] = [
  {
    _id: 'drinks', name: '饮品', type: 'drink', order: 1,
    subcategories: [{ id: 'sweet', name: '甜口' }, { id: 'water', name: '矿泉水' }],
  },
  {
    _id: 'food', name: '食品', type: 'food', order: 2,
    subcategories: [{ id: 'snacks', name: '零食' }, { id: 'filling', name: '垫腹' }],
  },
]

function setup(over: Partial<ComponentProps<typeof TopNav>> = {}) {
  const onTopChange = vi.fn()
  const onSubChange = vi.fn()
  const onSearchToggle = vi.fn()
  render(
    <TopNav
      categories={cats}
      activeTop="drinks"
      activeSub=""
      onTopChange={onTopChange}
      onSubChange={onSubChange}
      onSearchToggle={onSearchToggle}
      showSearch={false}
      {...over}
    />,
  )
  return { onTopChange, onSubChange, onSearchToggle }
}

describe('TopNav 商品分类导航', () => {
  it('目录为空时渲染骨架占位并标注 aria-busy，而不是整条导航返回 null', () => {
    render(
      <TopNav
        categories={[]}
        activeTop=""
        activeSub=""
        onTopChange={() => {}}
        onSubChange={() => {}}
        onSearchToggle={() => {}}
        showSearch={false}
      />,
    )
    const nav = screen.getByRole('navigation', { name: '商品分类导航' })
    expect(nav.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0)
    // 骨架态不渲染任何可点的分类按钮（数据还没到，点了也无处可去）
    expect(screen.queryByRole('button', { name: /切换到/ })).toBeNull()
  })

  it('选中态完全由 props 决定（外部传 food 就高亮 food，组件内不自存）', () => {
    setup({ activeTop: 'food' })
    expect(screen.getByRole('button', { name: '切换到食品分类' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '切换到饮品分类' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('子分类跟随当前大类渲染，「全部」在 activeSub 为空时按下', () => {
    setup()
    expect(screen.getByRole('button', { name: '显示全部商品' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '切换到甜口分类' })).toBeTruthy()
    // 食品大类下的子类不应出现在饮品下
    expect(screen.queryByRole('button', { name: '切换到零食分类' })).toBeNull()
  })

  it('activeSub 命中时对应子类按下，且不再渲染「全部」按下态', () => {
    setup({ activeSub: 'snacks', activeTop: 'food' })
    expect(screen.getByRole('button', { name: '切换到零食分类' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '显示全部商品' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('切大类会先清空子分类再上报大类（避免 URL 停在 food/snacks 却点了饮品）', () => {
    const { onTopChange, onSubChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: '切换到食品分类' }))
    expect(onSubChange).toHaveBeenNthCalledWith(1, '')
    expect(onTopChange).toHaveBeenNthCalledWith(1, 'food')
  })

  it('点子类只上报子类，不动大类', () => {
    const { onTopChange, onSubChange } = setup({ activeTop: 'food', activeSub: '' })
    fireEvent.click(screen.getByRole('button', { name: '切换到垫腹分类' }))
    expect(onSubChange).toHaveBeenCalledWith('filling')
    expect(onTopChange).not.toHaveBeenCalled()
  })

  it('搜索按钮的标签与 aria-pressed 随展开态翻转', () => {
    const { onSearchToggle } = setup()
    const btn = screen.getByRole('button', { name: '搜索商品' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(onSearchToggle).toHaveBeenCalledTimes(1)

    render(
      <TopNav
        categories={cats}
        activeTop="drinks"
        activeSub=""
        onTopChange={() => {}}
        onSubChange={() => {}}
        onSearchToggle={() => {}}
        showSearch
      />,
    )
    const open = screen.getAllByRole('button', { name: '关闭搜索' })
    expect(open[open.length - 1].getAttribute('aria-pressed')).toBe('true')
  })

  it('子分类滚动区可被键盘聚焦（原生 overflow 区默认不可聚焦）', () => {
    setup()
    const group = screen.getByRole('group', { name: '子分类筛选' })
    expect(group.getAttribute('tabindex')).toBe('0')
  })
})
