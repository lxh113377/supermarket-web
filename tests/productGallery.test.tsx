// @vitest-environment jsdom
// 商品图集 ProductGallery（七轮 H2，原覆盖 0%）：单图 srcSet / 多图轮播 / 键盘翻图 / 加载失败降级
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProductGallery from '../src/components/product/ProductGallery'
import type { Product } from '../src/types'

const mk = (over: Partial<Product> = {}): Product => ({
  _id: 'p12', name: '可乐', spec: '500ml', price: 3.5, order: 12, ...over,
} as unknown as Product)

afterEach(() => { cleanup() })

describe('单图与占位', () => {
  it('无 images 时按 order 拼原图并带 srcSet（400w 小图优先）', () => {
    const { container } = render(<ProductGallery product={mk()} gallery={[]} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/images/12.webp')
    expect(img.getAttribute('srcset')).toContain('/images/sm/12.webp 400w')
    expect(img.getAttribute('loading')).toBe('eager') // 详情主图不参与懒加载（LCP 元素）
    expect(img.getAttribute('fetchpriority')).toBe('high')
  })

  it('product.image 自定义图优先且不挂 srcSet（外链没有 sm 版本）', () => {
    const { container } = render(<ProductGallery product={mk({ image: 'https://cdn/x.png' })} gallery={[]} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn/x.png')
    expect(img.getAttribute('srcset')).toBeNull()
  })

  it('无图可展示 → 品牌渐变占位（含名称与规格），不留空白块', () => {
    render(<ProductGallery product={mk({ order: undefined, _id: '', image: undefined })} gallery={[]} />)
    expect(screen.getByText('可乐')).toBeTruthy()
    expect(screen.getByText('500ml')).toBeTruthy()
  })

  it('单图加载失败 → 降级为占位组件', () => {
    const { container } = render(<ProductGallery product={mk()} gallery={[]} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('可乐')).toBeTruthy()
  })
})

describe('多图轮播', () => {
  const gallery = ['/images/1.webp', '/images/2.webp', '/images/3.webp']

  it('指示点数量与图数一致，当前项 aria-current=true', () => {
    render(<ProductGallery product={mk()} gallery={gallery} />)
    expect(screen.getByRole('group', { name: '可乐 图片，第 1 / 3 张' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看第 2 张图片' }).getAttribute('aria-current')).toBe('false')
    expect(screen.getByRole('button', { name: '查看第 1 张图片' }).getAttribute('aria-current')).toBe('true')
  })

  it('next/prev 环绕（首张往前回到末张）', () => {
    render(<ProductGallery product={mk()} gallery={gallery} />)
    fireEvent.click(screen.getByRole('button', { name: '上一张图片' }))
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('可乐 图片，第 3 / 3 张')
    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }))
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('可乐 图片，第 1 / 3 张')
  })

  it('键盘 ←/→ 翻图（触屏之外的等价操作）', () => {
    render(<ProductGallery product={mk()} gallery={gallery} />)
    const g = screen.getByRole('group')
    fireEvent.keyDown(g, { key: 'ArrowRight' })
    expect(g.getAttribute('aria-label')).toBe('可乐 图片，第 2 / 3 张')
    fireEvent.keyDown(g, { key: 'ArrowLeft' })
    expect(g.getAttribute('aria-label')).toBe('可乐 图片，第 1 / 3 张')
    fireEvent.keyDown(g, { key: 'Enter' }) // 无关按键不改态
    expect(g.getAttribute('aria-label')).toBe('可乐 图片，第 1 / 3 张')
  })

  it('指示点直接跳位', () => {
    render(<ProductGallery product={mk()} gallery={gallery} />)
    fireEvent.click(screen.getByRole('button', { name: '查看第 3 张图片' }))
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('可乐 图片，第 3 / 3 张')
  })

  it('当前张加载失败只占位该张，切走后可恢复（错误态按索引记录）', () => {
    const { container } = render(<ProductGallery product={mk()} gallery={gallery} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看第 2 张图片' }))
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/images/2.webp')
  })

  it('单图时不渲染轮播控件（键盘也不响应）', () => {
    render(<ProductGallery product={mk()} gallery={['/images/12.webp']} />)
    expect(screen.queryByRole('button', { name: '下一张图片' })).toBeNull()
    expect(screen.getByAltText('可乐').getAttribute('src')).toBe('/images/12.webp')
  })

  it('gallery 只有一张自定义图时用那张，而不是按 order 拼的路径（七轮修的实际错图缺陷）', () => {
    render(<ProductGallery product={mk()} gallery={['/uploads/real-photo.jpg']} />)
    const img = screen.getByAltText('可乐')
    expect(img.getAttribute('src')).toBe('/uploads/real-photo.jpg')
    expect(img.getAttribute('srcset')).toBeNull() // 非 order 路径没有 sm/ 版本，不能挂 srcSet
  })
})
