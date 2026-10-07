// 入场遮罩（splash）：加载进度就绪后整块上抽，露出 hero。
//
// 为什么是**遮罩式**而不是交叠式/共享元素式：后两者都依赖"两个页面同时存在 DOM"
// （旧页与新页同时在场、或元素几何位置跨路由对齐），在 React 路由卸载时序下极易出现
// 元素先被卸载再取 rect ⇒ 动画落空或闪一下白。遮罩式只有一个全屏层，
// 时序上只有"盖住 → 抽走"两步，是三者里唯一不含竞态的。

import { useEffect, useState } from 'react'

interface Props {
  /** 0 → 1 的资源加载进度。 */
  ratio: number
  /** 外部判定"可以进场了"（资源就绪或超时兜底）。 */
  ready: boolean
  /** 抽离动画结束（此时才把 DOM 摘掉，避免动画被卸载打断）。 */
  onExited: () => void
}

export default function PrintSplash({ ratio, ready, onExited }: Props) {
  const [out, setOut] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!ready) return
    // 进度条先补满再抽走：直接从 60% 消失会让人以为卡了
    const t = setTimeout(() => setOut(true), 320)
    return () => clearTimeout(t)
  }, [ready])

  useEffect(() => {
    if (!out) return
    const t = setTimeout(() => { setGone(true); onExited() }, 900)
    return () => clearTimeout(t)
  }, [out, onExited])

  if (gone) return null

  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)

  return (
    <div
      className={`print-mask ${out ? 'print-mask--out' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="打印页面加载中"
    >
      <div className="print-core" />
      <p className="text-[13px] tracking-[0.32em] text-slate-300/80 uppercase">PRINT</p>
      <div className={`print-bar ${out ? 'print-bar--done' : ''}`}>
        <i style={{ width: `${out ? 100 : Math.max(8, pct)}%` }} />
      </div>
      <p className="text-[11px] text-slate-500 tabular-nums">{out ? '进入走廊' : `正在铺开走廊 ${pct}%`}</p>
    </div>
  )
}
