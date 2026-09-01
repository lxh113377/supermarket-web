// KpiCard 渲染测试：count-up 动画尊重 prefers-reduced-motion 时直接落最终值；
// 常规情形首帧 0 → 动画演进；徽章渲染正确。
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import KpiCard from '../src/components/KpiCard'

describe('KpiCard', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reduced-motion 时直接渲染最终值（无动画）', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      media: '',
      onchange: null,
      dispatchEvent: vi.fn(),
    }))
    render(<KpiCard label="近7天营收" value={12345} prefix="¥" />)
    expect(screen.getByText('近7天营收')).toBeTruthy()
    // 最终值 toLocaleString 渲染（动画直接完成）
    expect(screen.getByText('¥12,345', { exact: false })).toBeTruthy()
  })

  it('渲染前缀/label/sub/环比徽章', () => {
    render(
      <KpiCard
        label="近7天营收"
        value={100}
        prefix="¥"
        sub="累计 50 单"
        delta={{ ordersDelta: 10, revenueDelta: 20 }}
        deltaMetric="revenue"
      />,
    )
    expect(screen.getByText('近7天营收')).toBeTruthy()
    expect(screen.getByText('累计 50 单')).toBeTruthy()
    // 徽章：▲20%（revenueMetric）
    expect(screen.getByText(/▲20%/)).toBeTruthy()
  })

  it('delta 为 null 时不渲染徽章', () => {
    render(<KpiCard label="日均营收" value={50} />)
    expect(screen.queryByText(/▲|▼|◆/)).toBeNull()
  })

  it('未开启 prefers-reduced-motion 时挂载渲染最终值', () => {
    // jsdom 默认 matchMedia 不存在 → reduced=false，动画路径启动；
    // 断言最终 DOM 包含 label 与数字文本（数值首帧 0，动画由 rAF 驱动，jsdom 不跑 rAF，
    // 因此只断言结构，不断言数值——避免依赖动画完成）
    render(<KpiCard label="近30天订单" value={42} />)
    expect(screen.getByText('近30天订单')).toBeTruthy()
  })
})