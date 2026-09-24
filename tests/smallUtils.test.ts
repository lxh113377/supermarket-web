// 小工具纯函数补测（六轮 G 批）：format 30% / rovingTabs 52% / images 分支 64%
// 这三个文件都是"全站唯一真相源"型模块——错一处影响一片，且测起来零成本。
import { describe, it, expect, vi } from 'vitest'
import { formatCount, formatPercent, formatPrice, formatYuan } from '../src/utils/format'
import { productImageUrl, productSrcSet, productThumbUrl } from '../src/utils/images'
import { handleTablistKeyDown } from '../src/utils/rovingTabs'

describe('format 金额/计数/百分比', () => {
  it('价格固定两位小数（含四舍五入），非有限值降级为 0.00 而非 NaN', () => {
    expect(formatPrice(3.5)).toBe('3.50')
    expect(formatPrice(0.005)).toBe('0.01')
    expect(formatPrice(1234.567)).toBe('1234.57')
    expect(formatPrice(NaN)).toBe('0.00')
    expect(formatPrice(Infinity)).toBe('0.00')
    expect(formatYuan(7)).toBe('¥7.00')
  })

  it('计数取整并加千分位（zh-CN 分组）', () => {
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(1234567.6)).toBe('1,234,568')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(NaN)).toBe('0')
  })

  it('百分比：无基准显示「—」而不是伪造 0%', () => {
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatPercent(0.1234, 0)).toBe('12%')
    expect(formatPercent(-0.5)).toBe('-50.0%')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
    expect(formatPercent(NaN)).toBe('—')
  })
})

describe('images URL 拼装', () => {
  it('order 缺失/空串/纯空白 → 原图与缩略图都返回 null，srcSet 返回 undefined', () => {
    for (const bad of [undefined, null, '', '   ']) {
      expect(productImageUrl(bad)).toBeNull()
      expect(productThumbUrl(bad)).toBeNull()
      expect(productSrcSet(bad)).toBeUndefined()
    }
  })

  it('number 与 string order 归一化为同一路径（后端 D1 两种都会回）', () => {
    expect(productImageUrl(12)).toBe('/images/12.webp')
    expect(productImageUrl('12')).toBe('/images/12.webp')
    expect(productThumbUrl(' 12 ')).toBe('/images/sm/12.webp')
    expect(productSrcSet(12)).toBe('/images/sm/12.webp 400w, /images/12.webp 800w')
  })

  it('order 为 0 是合法编号，不得当假值丢掉', () => {
    expect(productImageUrl(0)).toBe('/images/0.webp')
    expect(productSrcSet(0)).toContain('/images/sm/0.webp')
  })
})

describe('rovingTabs 方向键导航', () => {
  const mk = (key: string) => ({ key, preventDefault: vi.fn() }) as never
  const values = ['7', '30', '90']

  it('右移/左移并循环环绕', () => {
    const onPick = vi.fn()
    const e = mk('ArrowRight')
    handleTablistKeyDown(e, values, '90', onPick)
    expect(onPick).toHaveBeenCalledWith('7')
    handleTablistKeyDown(mk('ArrowLeft'), values, '7', onPick)
    expect(onPick).toHaveBeenLastCalledWith('90')
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Home/End 跳首尾', () => {
    const onPick = vi.fn()
    handleTablistKeyDown(mk('Home'), values, '30', onPick)
    expect(onPick).toHaveBeenCalledWith('7')
    handleTablistKeyDown(mk('End'), values, '30', onPick)
    expect(onPick).toHaveBeenCalledWith('90')
  })

  it('无关按键与未知当前值都静默返回（不 preventDefault 抢走浏览器行为）', () => {
    const onPick = vi.fn()
    const arrow = mk('ArrowRight')
    handleTablistKeyDown(arrow, values, '365', onPick)
    const tab = mk('Tab')
    handleTablistKeyDown(tab, values, '30', onPick)
    expect(onPick).not.toHaveBeenCalled()
    expect(arrow.preventDefault).not.toHaveBeenCalled()
    expect(tab.preventDefault).not.toHaveBeenCalled()
  })

  it('默认聚焦用 tab-<value> id，可传 focusTab 覆盖（AdminPage 的 id 规则不同）', () => {
    const el = { focus: vi.fn() }
    const spy = vi.spyOn(document, 'getElementById').mockImplementation(() => el as unknown as HTMLElement)
    handleTablistKeyDown(mk('ArrowRight'), values, '7', vi.fn())
    expect(spy).toHaveBeenCalledWith('tab-30')
    expect(el.focus).toHaveBeenCalled()
    spy.mockRestore()

    const focusTab = vi.fn()
    handleTablistKeyDown(mk('ArrowLeft'), values, '7', vi.fn(), focusTab)
    expect(focusTab).toHaveBeenCalledWith('90')
  })
})
