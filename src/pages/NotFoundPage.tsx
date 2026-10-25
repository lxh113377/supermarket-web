import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconEmpty } from '../components/Icons'

/**
 * 404（2026-10-25 交互升级，视觉语言沿用 2026-10-22 那次定稿：柿色渐变 + 右下切角）。
 * 新增「提灯找路」反馈：光标在页面上移动时，柿形徽记朝光标方向轻微倾转，
 * 数字水印 404 反向慢移半拍 —— 一块「页面走丢了，但店还在找你」的活体隐喻。
 * 只在桌面精确指针下启用（pointer: fine），触屏与 prefers-reduced-motion 全静态降级；
 * 视差用 transform 合成层，不触发重排，位移幅度 <20px 无可感知布局偏移。
 *
 * 装饰口径沿用：数字 404 是图形不是正文 —— 88px 超大字号、语义由「页面走丢了」承载，
 * 低对比是设计意图，用 data-decorative 显式声明（2026-10-23 更正的口径，不是拿
 * aria-hidden 当装饰代理）。
 */
export default function NotFoundPage() {
  const navigate = useNavigate()
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [shift, setShift] = useState({ x: 0, y: 0 })
  const rafRef = useRef(0)
  const fineRef = useRef(false)

  useEffect(() => {
    // jsdom（单测环境）不实现 matchMedia ⇒ 必须先探存在再调，视差是增强不是依赖
    const hasMq = typeof window.matchMedia === 'function'
    fineRef.current = hasMq && window.matchMedia('(pointer: fine)').matches
    const reduced = hasMq && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fineRef.current || reduced) return
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        // 以视口中心为原点：光标偏右 ⇒ 徽记朝右倾，水印朝左退（反向才有「牵引感」）
        const dx = e.clientX / window.innerWidth - 0.5
        const dy = e.clientY / window.innerHeight - 0.5
        setTilt({ x: dx * 14, y: dy * -10 })
        setShift({ x: dx * -18, y: dy * -12 })
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div role="main" id="main-content" tabIndex={-1} className="page-container paper-grain flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div
        aria-hidden="true"
        className="cover-clip relative mb-8 flex h-20 w-20 items-center justify-center"
        style={{
          background: 'linear-gradient(155deg, #d9b166, #b18739 62%, #7a5c20)',
          transform: `perspective(420px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
          transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
      >
        <IconEmpty className="h-9 w-9 text-ink" />
      </div>

      <p
        aria-hidden="true"
        data-decorative="true"
        className="price-num select-none text-[5.5rem] font-extrabold leading-none text-stone-200"
        style={{
          transform: `translate(${shift.x}px, ${shift.y}px)`,
          transition: 'transform 600ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
      >
        404
      </p>
      {/* 装饰大字 404 的色温沿用 stone-200 口径（L* 与 gray-200 差 0.5，视觉亮度不变） */}
      <h1 className="-mt-3 text-display-md text-ink">页面走丢了</h1>
      <p className="mt-2 text-sm text-stone-500">这个地址不存在，可能已被移动或删除。</p>

      <button
        onClick={() => navigate('/')}
        className="btn-primary mt-8 px-7 py-3 text-sm"
      >
        返回首页
      </button>

      <span aria-hidden="true" className="brand-bar mt-12 h-0.5 w-12 rounded-full opacity-60" />
    </div>
  )
}
