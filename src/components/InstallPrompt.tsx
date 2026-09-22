import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

// beforeinstallprompt 的 TS 声明（浏览器原生类型尚未内置）
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'sm_pwa_dismissed'

// PWA 安装引导条，三态适配：
//  1) 标准浏览器（Chrome 等，有 beforeinstallprompt）→ 系统安装弹窗按钮
//  2) 微信内置浏览器（MicroMessenger，无该事件）→ 手动引导条（右上角 ··· 添加到主屏幕/桌面），
//     安卓/iOS 文案分开；微信无法程序触发系统弹窗，只能教用户手动操作
//  3) iOS Safari（无该事件）→ 引导手动添加到主屏幕
// 手动引导场景仅会话内提示一次（sessionStorage）；「稍后再说」永久静默（localStorage）。
// 仅顾客端路由（非 /admin）展示。
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const location = useLocation()

  const isWeChat = /MicroMessenger/i.test(navigator.userAgent)
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  // 标准浏览器：监听 beforeinstallprompt（可程序触发系统弹窗）
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

  // 无 beforeinstallprompt 的环境（微信 / iOS Safari）：引导手动添加，仅会话内提示一次
  useEffect(() => {
    // 微信内置浏览器：即使内核定义了 BeforeInstallPromptEvent 构造器也不会触发该事件，强制走手动引导
    if (isWeChat) {
      try {
        if (sessionStorage.getItem('sm_pwa_manual_hint')) return
        sessionStorage.setItem('sm_pwa_manual_hint', '1')
        setVisible(true)
      } catch {}
      return
    }
    if ('BeforeInstallPromptEvent' in window) return // 标准浏览器走事件
    if (!isIOS) return // 其他环境不打扰
    try {
      if (sessionStorage.getItem('sm_pwa_manual_hint')) return
      sessionStorage.setItem('sm_pwa_manual_hint', '1')
      setVisible(true)
    } catch {}
  }, [isWeChat, isIOS])

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

  // 手动引导场景（微信 / iOS Safari）的步骤文案；无法程序触发系统弹窗
  const manualStep = isWeChat
    ? (isIOS
      ? '点击右上角 ··· → 选择「添加到主屏幕」'
      : '点击右上角 ··· → 选择「添加到桌面」')
    : '点击底部分享按钮 → 选择「添加到主屏幕」'

  return (
    /* 层级约定（浮层层级重排，2026-09-23）：
       页面吸底/浮条 z-20~30 < 安装引导 z-[70] < 模态遮罩 z-[80]（Overlay） < 路由加载 z-[100]
       原为 z-[90]，会盖在模态遮罩之上 —— 弹窗打开时「立即添加」按钮可被误点。 */
    <div className="fixed bottom-0 inset-x-0 z-[70] px-4 pb-4 pointer-events-none">
      <div className="max-w-lg mx-auto bg-white rounded-2xl border border-gray-100/80 shadow-elevated p-4 flex items-center gap-3 pointer-events-auto animate-slide-up safe-bottom">
        <div className="w-10 h-10 rounded-xl brand-bar shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">添加到主屏幕</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            {deferred
              ? '像 App 一样打开江科一站通，下单更方便'
              : manualStep + '，像 App 一样使用'}
          </p>
        </div>
        <button onClick={dismiss} aria-label="稍后再说" className="text-gray-400 text-xl px-1 hover:text-gray-600 transition shrink-0">×</button>
        {deferred && (
          <button
            onClick={install}
            className="px-3.5 py-2 bg-brand-500 text-white rounded-xl text-xs font-medium hover:bg-brand-600 active:scale-95 transition shrink-0"
          >
            立即添加
          </button>
        )}
      </div>
    </div>
  )
}
