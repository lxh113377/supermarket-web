import { useEffect, useRef, type ReactNode } from 'react'

interface OverlayProps {
  /** 是否展出（默认 true；便于调用方用条件渲染控制） */
  open?: boolean
  /** 关闭回调（Esc / 点击遮罩 / 关闭按钮都走它） */
  onClose: () => void
  children: ReactNode
  /** 容器附加类（默认居中卡片） */
  className?: string
  /** 无障碍名称：读屏播报用（如「确认订单」「图片预览」） */
  label?: string
  /** 点击遮罩是否关闭，默认 true。加载态遮罩应传 false */
  closeOnBackdrop?: boolean
  /** 是否启用 Esc 关闭，默认 true */
  closeOnEsc?: boolean
}

/**
 * 统一模态容器 —— 补齐此前 7 处遮罩各自实现的缺口：
 *   ① role="dialog" + aria-modal：读屏知道这是对话框而非普通内容
 *   ② 焦点陷阱：Tab / Shift+Tab 不会跑到背景页面
 *   ③ 打开时自动聚焦、关闭时焦点归还到触发元素
 *   ④ 打开期间锁背景滚动
 * 注意：onClose 用 ref 持有，effect 不因父组件重渲染而重跑（否则焦点会被反复重置）。
 */
export default function Overlay({
  open = true,
  onClose,
  children,
  className = '',
  label,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: OverlayProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscRef = useRef(closeOnEsc)

  useEffect(() => {
    onCloseRef.current = onClose
    closeOnEscRef.current = closeOnEsc
  })

  useEffect(() => {
    if (!open) return
    const box = boxRef.current
    lastFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null

    // 初始焦点：优先显式标记的元素，其次第一个可聚焦元素，最后容器自身
    const selector =
      '[data-autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const first = box?.querySelector<HTMLElement>(selector)
    ;(first ?? box)?.focus?.()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscRef.current) {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !box) return
      const nodes = Array.from(box.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        box.focus()
        return
      }
      const firstEl = nodes[0]
      const lastEl = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || active === box)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // 焦点归还：避免关闭后焦点丢到 body（键盘用户会迷失位置）
      lastFocusedRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`relative card-base p-5 w-full max-w-sm animate-scale-in focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
