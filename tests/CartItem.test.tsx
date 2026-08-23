import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import CartItem from '../src/components/CartItem'
import type { CartItem as CartItemType } from '../src/types'

// 组件冒烟：用 react-dom/server renderToString 在 Node 环境渲染纯展示组件，
// 无需 jsdom/testing-library，验证组件能正常渲染关键内容与控件。
const item = {
  _id: 'ci_1',
  productId: 'p1',
  name: '可乐',
  spec: '500ml',
  price: 3.5,
  quantity: 2,
  image: '',
} as CartItemType

describe('CartItem 组件（SSR 渲染冒烟）', () => {
  it('渲染名称、规格、单价、数量与增删控件', () => {
    const html = renderToString(
      <CartItem item={item} onAdd={() => {}} onRemove={() => {}} onDelete={() => {}} />,
    )
    expect(html).toContain('可乐 (500ml)')
    expect(html).toContain('¥')
    expect(html).toContain('3.50')
    expect(html).toContain('2')
    expect(html).toContain('减少可乐 (500ml)')
    expect(html).toContain('增加可乐 (500ml)')
    expect(html).toContain('删除')
  })

  it('无规格时仅显示名称', () => {
    const noSpec = { ...item, spec: undefined } as CartItemType
    const html = renderToString(
      <CartItem item={noSpec} onAdd={() => {}} onRemove={() => {}} onDelete={() => {}} />,
    )
    expect(html).toContain('>可乐<')
    expect(html).not.toContain('(')
  })
})