import { useEffect, useRef, useState } from 'react'

interface FlyDotProps {
  x: number
  y: number
  tx: number
  ty: number
  onDone: () => void
}

/**
 * 加购飞行动画：从卡片加购按钮飞向底部结算浮球。
 *
 * 2026-10-26 三处一手缺陷一起修（本站最强的「加到了」即时反馈此前是**隐形的**）：
 *  ① background 写的是 `var(--brand-500)` —— 站内令牌名是 `--t-brand-500`，
 *     缺前缀的那个变量全站零定义 ⇒ computed 整链清空 ⇒ 飞点**从未被看见过**
 *     （与 forest / espresso / brand-bar 同一族病：引用面改了、定义面没有）。
 *  ② transition 写的是 `all 0.6s cubic-bezier(0.5,0,0,1)`：曲线不在册、时长 600ms
 *     虽在 50ms 网格上但属性表是 all，而补间的是 left/top/width/height
 *     —— 四个**布局属性**，每一帧都触发重排（全站 transition-all 已被源码棘轮禁掉，
 *     这条走 inline style，判据看不见 ⇒ 漏网）。改成只补间 transform 与 opacity：
 *     位移走 translate（合成层，零重排），收缩走 scale（同一个 transform 里）。
 *  ③ 起点用 transform 定位，元素本身钉在视口原点 —— fixed + left/top 常量，
 *     动画期间不再有任何布局写入。
 *
 * prefers-reduced-motion：整块不挂载由调用方（CustomerPage）判断，这里不重复读媒体查询，
 * 避免「一处判、一处不判」的口径漂移。
 */
export default function FlyDot({ x, y, tx, ty, onDone }: FlyDotProps) {
  // 起点 = 加购按钮中心；终点 = 结算浮球中心（调用方已量好，这里只算位移量）
  const dx = tx - x
  const dy = ty - y
  const [moved, setMoved] = useState(false)
  const onDoneRef = useRef(onDone)
  // 渲染提交后同步最新回调（react/refs 要求不在渲染期写 ref；timeout 读取时序不变）
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    // 双帧：第一帧把起点写进 DOM，第二帧才改到终点 —— 否则浏览器没有
    // 「起始值 → 目标值」的差量可补间，元素会直接出现在终点（实测过的老坑）。
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setMoved(true)) })
    const t = setTimeout(() => onDoneRef.current(), 650)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t) }
  }, [])

  return (
    <div
      aria-hidden="true"
      data-decorative="true"
      className="fly-dot"
      style={{
        transform: moved ? `translate(${dx}px, ${dy}px) scale(0.28)` : 'translate(0, 0) scale(1)',
        opacity: moved ? 0 : 1,
      }}
    />
  )
}
