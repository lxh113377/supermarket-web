// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AnswerShelf from '../src/components/service/AnswerShelf'

// matchShelf 的取数口由 tests/answerShelf.test.ts 钉；这里钉的是**渲染面**：
// 命中时到底有没有把货架、价签、链接画出来，以及零命中时是不是整块不渲染。
// 分两件是因为它们会各自坏：取数正常但组件返 null（首页货架那次横滑就是渲染面坏）、
// 或渲染正常但取数永不命中（FlyDot 那次正则就是取数面坏）。
const ANSWER = '天热推荐东方树叶青柑普洱，和其正凉茶也不错。'

describe('AnswerShelf 渲染', () => {
  it('命中时：每件都是一个可点进详情的链接，带暖台照片与价签', () => {
    render(<MemoryRouter><AnswerShelf answer={ANSWER} /></MemoryRouter>)
    const links = screen.getAllByRole('link')
    expect(links.length, '零链接 ⇒ 组件没渲染出货架').toBeGreaterThan(0)
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^\/product\/p_\d+$/)
      expect(a.querySelector('.answer-shelf-photo img'), '缺照片 ⇒ 台面没挂上').toBeTruthy()
      expect(a.querySelector('.answer-shelf-tag'), '缺价签 ⇒ 价格没落地').toBeTruthy()
    }
  })

  // 结构口径：价签必须在**照片内部**。第一版它是照片的兄弟，而条目没有
  // position: relative ⇒ 绝对定位逃逸到祖先，三个价签叠成同一个（目检才发现）。
  // jsdom 不做布局，所以这里只能断**父子关系**；「落在自己照片内 + 三者位置互异」
  // 由浏览器探针 _design-qa/probe-shelf.cjs 量（几何断言在 jsdom 里恒为 0 矩形，测不出）。
  it('每件商品的价签都在自己的照片内部（防绝对定位逃逸叠成一个）', () => {
    render(<MemoryRouter><AnswerShelf answer={ANSWER} /></MemoryRouter>)
    const photos = document.querySelectorAll('.answer-shelf-photo')
    expect(photos.length, '零照片 ⇒ 货架没渲染').toBeGreaterThan(0)
    for (const ph of Array.from(photos)) {
      expect(ph.querySelector('.answer-shelf-tag'), '价签不在照片内 ⇒ 会叠到祖先坐标系上').toBeTruthy()
    }
    // 反向半边：条目直接子级里不该再出现价签
    for (const el of Array.from(document.querySelectorAll('.answer-shelf-item'))) {
      expect(el.querySelector(':scope > .answer-shelf-tag'), '价签挂在条目直子级 = 旧写法复发').toBeNull()
    }
  })

  it('照片是装饰（alt 空）：名称已由文字叶承载，读屏不该每行念两遍同名', () => {
    render(<MemoryRouter><AnswerShelf answer={ANSWER} /></MemoryRouter>)
    const imgs = document.querySelectorAll('.answer-shelf-photo img')
    expect(imgs.length).toBeGreaterThan(0)
    for (const im of Array.from(imgs)) expect(im.getAttribute('alt')).toBe('')
  })

  it('零命中时整块不渲染（不摆空货架，也不摆「没有找到相关商品」这种噪音）', () => {
    const { container } = render(<MemoryRouter><AnswerShelf answer="我们工作日 17:37 到 23:00 营业。" /></MemoryRouter>)
    expect(container.firstChild).toBeNull()
  })
})
