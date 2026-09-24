import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface FlyDotProps {
  x: number
  y: number
  tx: number
  ty: number
  onDone: () => void
}

/** 加购飞行动画：从卡片加购按钮飞向底部结算浮球。 */
export default function FlyDot({ x, y, tx, ty, onDone }: FlyDotProps) {
  const endX = tx - 10
  const endY = ty - 10
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    left: x,
    top: y,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'var(--brand-500)',
    zIndex: 60,
    pointerEvents: 'none' as const,
    transition: 'all 0.6s cubic-bezier(0.5,0,0,1)',
    boxShadow: '0 2px 8px rgba(234,179,8,0.4)',
  })

  // onDone 通过 ref 持有，避免 effect 依赖不稳定的内联回调导致动画重复触发
  const onDoneRef = useRef(onDone)
  // 渲染提交后同步最新回调（react/refs 要求不在渲染期写 ref；timeout 读取时序不变）
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    setStyle(s => ({ ...s, left: endX, top: endY, width: 6, height: 6, opacity: 0 }))
    const t = setTimeout(() => onDoneRef.current(), 650)
    return () => clearTimeout(t)
  }, [endX, endY])

  return <div style={style} />
}
