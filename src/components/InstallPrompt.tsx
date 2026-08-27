import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

// beforeinstallprompt 的 TS 声明（浏览器原生类型尚未内置）
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'sm_pwa_dismissed'

// PWA 安装引导条：监听 beforeinstallprompt；iOS Safari 无该事件时仅会话内提示一次。
// 拒绝后 localStorage 标记不再打扰；仅顾客端路由（非 /admin）展示。
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      try {
        if (localStorage.getItem(DISMISS_KEY)) return
      } catch {}
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // iOS Safari：无 beforeinstallprompt，会话内静态提示一次（引导手动「添加到主屏」）
  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('BeforeInstallPromptEvent' in window)
    if (!isIOS) return
    try {
      if (sessionStorage.getItem('sm_pwa_ios_hint')) return
      sessionStorage.setItem('sm_pwa_ios_hint', '1')
      setVisible(true)
    } catch {}
  }, [])

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    setVisible(false)
  }

  const install = async () => {
    if (deferred) {
      try { await deferred.prompt() } catch {}
    }
    setVisible(false)
  }

  if (!visible || location.pathname.startsWith('/admin')) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-[90] px-4 pb-4 pointer-events-none">
      <div className="max-w-lg mx-auto bg-white rounded-2xl border border-gray-100/80 shadow-elevated p-4 flex items-center gap-3 pointer-events-auto animate-slide-up safe-bottom">
        <div className="w-10 h-10 rounded-xl brand-bar shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">添加到主屏幕</p>
          <p className="text-[11px] text-gray-500">像 App 一样打开江科一站通，下单更方便</p>
        </div>
        <button onClick={dismiss} aria-label="稍后再说" className="text-gray-400 text-xl px-1 hover:text-gray-600 transition shrink-0">×</button>
        <button
          onClick={install}
          className="px-3.5 py-2 bg-brand-500 text-white rounded-xl text-xs font-medium hover:bg-brand-600 active:scale-95 transition shrink-0"
        >
          立即添加
        </button>
      </div>
    </div>
  )
}
