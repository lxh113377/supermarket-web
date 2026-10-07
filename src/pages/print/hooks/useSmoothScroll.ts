// 平滑滚动（Lenis）+ 分段停靠 + 单向推进。
//
// 三件事收在一个 hook 里是因为它们共用同一个滚动源，拆开就会出现
// "两个监听器各算各的进度" 这种经典漂移（进度差一帧，相机就会顿一下）。
//
// · 平滑滚动：Lenis 接管 wheel/touch，用 rAF 插值写 scrollTop（MIT 许可）
// · 分段式：滚动停止后吸附到最近章节（只在离边界 35% 视口内才吸，避免抢用户的滚动）
// · 单向推进：进度只增不减 —— 已走过的走廊不倒退，已揭晓的文案不收回
//   （DOM 仍可向上滚回去看表单，伤不到可用性，但视觉阶段不可逆）

import { useEffect, useRef, type MutableRefObject } from 'react'
import Lenis from 'lenis'

interface Options {
  /** 章节元素的容器（用于取每个 section 的 offsetTop）。 */
  containerRef: MutableRefObject<HTMLElement | null>
  /** 单调递增的进度（每帧被相机读取，故用 ref 而非 state）。 */
  progressRef: MutableRefObject<number>
  /** 是否关闭平滑滚动与吸附（prefers-reduced-motion / 低端设备）。 */
  calm?: boolean
}

const SNAP_RATIO = 0.35

export function useSmoothScroll({ containerRef, progressRef, calm = false }: Options) {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    progressRef.current = 0
    if (calm) {
      // 降级路径：不加平滑、不吸附，只把原生滚动映射成进度（同样单调化）
      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        const raw = max > 0 ? window.scrollY / max : 0
        progressRef.current = Math.max(progressRef.current, Math.min(1, raw))
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      onScroll()
      return () => window.removeEventListener('scroll', onScroll)
    }

    const lenis = new Lenis({
      duration: 1.05,
      // 分段式滚动的"段"感来自这里的缓动：松手后继续滑一段再停
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      // 移动端保留原生滚动：强制接管触屏会和输入框聚焦、长按选择打架
      syncTouch: false,
      touchMultiplier: 1.4,
      wheelMultiplier: 1,
    })
    lenisRef.current = lenis

    let raf = 0
    const loop = (time: number) => {
      lenis.raf(time)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    let snapTimer = 0
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const raw = max > 0 ? window.scrollY / max : 0
      // 单向：只取历史最大值。用户向上滚时相机停在前方，视觉阶段不回退
      progressRef.current = Math.max(progressRef.current, Math.min(1, raw))

      window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(() => {
        // 正在填表时不吸附：否则光标在输入框里、页面自己滑走是最恶劣的体验
        const el = document.activeElement
        if (el && /input|textarea|select/i.test(el.tagName)) return
        const container = containerRef.current
        if (!container) return
        const sections = Array.from(container.querySelectorAll<HTMLElement>('[data-print-section]'))
        if (sections.length === 0) return
        const y = window.scrollY
        const vh = window.innerHeight
        let best: HTMLElement | null = null
        let bestDist = Infinity
        for (const s of sections) {
          const top = s.getBoundingClientRect().top + y
          const d = Math.abs(top - y)
          if (d < bestDist) { bestDist = d; best = s }
        }
        if (best && bestDist < vh * SNAP_RATIO && bestDist > 4) {
          lenis.scrollTo(best, { duration: 0.75 })
        }
      }, 160)
    }

    lenis.on('scroll', onScroll)
    onScroll()

    return () => {
      window.clearTimeout(snapTimer)
      cancelAnimationFrame(raf)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [calm, containerRef, progressRef])

  return lenisRef
}
