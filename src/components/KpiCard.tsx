import React, { useEffect, useMemo, useRef, useState } from 'react'

// KPI 卡片（count-up 动画隔离在子树内）
// 原 useCountUp 直接写在 DashboardTab，每帧 rAF setValue 会让父组件整树重渲染，
// 800+ 订单时每次渲染都重算 rangeData/delta/topRevenue 等多个聚合。抽成独立组件后，
// count-up 的 setState 只影响本卡片子树，父组件只传最终值。
//
// 尊重 prefers-reduced-motion：启用时直接落最终值，无动画。

// 每帧数值插值（三次缓出；与旧 useCountUp 行为一致）
function useCountUp(target: number, duration = 700): number {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
    [],
  )
  const [value, setValue] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    if (reduced) {
      setValue(target)
      prevRef.current = target
      return
    }
    const from = prevRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      if (p >= 1) {
        setValue(target)
        prevRef.current = target
      } else {
        setValue(from + (target - from) * (1 - Math.pow(1 - p, 3)))
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      prevRef.current = target
    }
  }, [target, duration, reduced])
  return value
}

function DeltaBadge({ value, positiveIsGood = true }: { value: number | null; positiveIsGood?: boolean }) {
  if (value === null) return <span className="delta-badge delta-flat">—</span>
  const up = value > 0
  const good = up === positiveIsGood
  return (
    <span className={`delta-badge ${value === 0 ? 'delta-flat' : good ? 'delta-up' : 'delta-down'}`}>
      {up ? '▲' : value < 0 ? '▼' : '◆'}{Math.abs(value)}%
    </span>
  )
}

export interface KpiDelta {
  ordersDelta: number | null
  revenueDelta: number | null
}

export default function KpiCard({ label, value, prefix = '', suffix = '', sub, accent = false, delta, deltaMetric = 'revenue', staggerCls = '' }: {
  label: string
  /** 最终展示值（整数；美元/元金额已提前 round） */
  value: number
  prefix?: string
  suffix?: string
  /** 第二行辅助文案（如「累计 N 单」） */
  sub?: string
  /** 首卡强调样式 */
  accent?: boolean
  /** 环比数据；为空则不渲染徽章 */
  delta?: KpiDelta | null
  /** 徽章取 delta 的哪个指标 */
  deltaMetric?: 'revenue' | 'orders'
  /** stagger 动画 class（如 'stagger-1'），保持入场节奏与旧版一致 */
  staggerCls?: string
}) {
  const animated = useCountUp(value)
  const cardCls = accent
    ? 'card-accent animate-fade-in-up'
    : 'bg-white shadow-card animate-fade-in-up'
  const deltaValue = delta ? (deltaMetric === 'revenue' ? delta.revenueDelta : delta.ordersDelta) : null

  return (
    <div className={`p-4 rounded-2xl border border-gray-100/80 text-center ${cardCls} ${staggerCls}`.trim()}>
      <p className={`text-xl font-bold ${accent ? 'text-brand-700' : 'text-gray-900'}`}>
        {prefix}{animated.toLocaleString()}{suffix}
      </p>
      <p className="text-[10px] text-gray-400 mt-1">{label}</p>
      {delta && (
        <div className="mt-1 flex justify-center">
          <DeltaBadge value={deltaValue} />
        </div>
      )}
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}