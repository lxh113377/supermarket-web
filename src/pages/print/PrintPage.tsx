// 打印页装配：splash（遮罩式入场）→ hero → 3D 实景导航段 → 下单表单。
//
// 本页刻意不复用站内视觉：深色影院感 + 霓虹光带，样式集中在 index.css 的 print-* 段。
// 3D 场景是懒加载的独立 chunk（three 生态体积大），且仅在环境支持时挂载。

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
// 打印页专属样式：随本路由的懒加载 chunk 一起下载，不进首屏 CSS（见 print.css 文件头）
import './print.css'
import PrintSplash from './PrintSplash'
import PrintHero from './PrintHero'
import PrintForm from './PrintForm'
import { useSmoothScroll } from './hooks/useSmoothScroll'
import { useAssetProgress } from './hooks/useAssetProgress'
import { CHAPTER_STOPS } from './scene/printTheme'

// 单独 chunk：three + R3F 只在这条路由进来时才下载，不进首屏
const PrintSceneCanvas = lazy(() => import('./scene/PrintSceneCanvas'))

/** 环境探测：无 WebGL / 用户要求减少动效 ⇒ 退化为静态渐变，表单功能完全不受影响。 */
function useSceneCapable() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce) return false
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      return !!gl
    } catch {
      return false
    }
  }, [])
}

const CHAPTERS = [
  { kicker: 'STEP 01', title: '穿过教学楼走廊', body: '把要印的东西拍下来，或者直接把 PDF 交给我们。' },
  { kicker: 'STEP 02', title: '写清送到哪栋哪间', body: '楼栋号与房间号是必填 —— 没有它，印好也送不到你手上。' },
  { kicker: 'STEP 03', title: '在尽头那家印好', body: '黑白、彩印、单双面、份数，写在备注里，我们照办。' },
]

export default function PrintPage() {
  const navigate = useNavigate()
  const sceneOk = useSceneCapable()
  const progressRef = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [stage, setStage] = useState(0)
  const { ratio } = useAssetProgress()

  // 资源就绪或超时 6s 兜底 —— 弱网下 3D 永远等不完，绝不能让 splash 把用户锁死
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (!sceneOk) { setTimedOut(true); return }
    const t = setTimeout(() => setTimedOut(true), 6000)
    return () => clearTimeout(t)
  }, [sceneOk])
  const ready = !sceneOk || timedOut || ratio >= 1

  useSmoothScroll({ containerRef, progressRef, calm: !sceneOk })

  // 章节揭晓：单向（只增不减），已出现的文案不会收回
  useEffect(() => {
    const t = setInterval(() => {
      const p = progressRef.current
      let next = 0
      for (let i = 1; i < CHAPTER_STOPS.length; i++) if (p >= CHAPTER_STOPS[i] - 0.06) next = i
      setStage((s) => (next > s ? next : s))
    }, 120)
    return () => clearInterval(t)
  }, [])

  const goHome = () => {
    if (leaving) return
    setLeaving(true)
    // 遮罩落下盖住页面后再跳：避免路由切换的那一帧闪出旧页面
    setTimeout(() => navigate('/'), 520)
  }

  return (
    <div ref={containerRef} className={`relative min-h-screen ${sceneOk ? 'print-bg' : 'print-bg--static'}`}>
      {sceneOk && (
        <Suspense fallback={null}>
          <PrintSceneCanvas progressRef={progressRef} />
        </Suspense>
      )}

      <div className="relative z-10">
        <PrintHero fileCount={0} />

        {CHAPTERS.map((c, i) => (
          <section
            key={c.kicker}
            data-print-section
            className="print-section flex items-center px-6"
          >
            <div className={`max-w-sm ${stage > i ? 'print-reveal print-reveal--shown' : 'print-reveal'}`}>
              <span className="text-[11px] tracking-[0.35em] text-cyan-200/70">{c.kicker}</span>
              <h2 className="print-title mt-3 text-[28px] font-bold leading-tight">{c.title}</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-slate-400">{c.body}</p>
              <div className="mt-6 h-px w-16 bg-gradient-to-r from-cyan-300 to-transparent" />
            </div>
          </section>
        ))}

        <PrintForm onHome={goHome} />
      </div>

      {!entered && <PrintSplash ratio={ratio} ready={ready} onExited={() => setEntered(true)} />}

      {leaving && <div className="print-mask print-mask--in" aria-hidden="true"><div className="print-core" /></div>}
    </div>
  )
}
