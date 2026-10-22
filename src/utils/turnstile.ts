// Turnstile 人机验证（前端侧）：按需懒加载官方脚本、渲染隐式组件、取 token。
//
// 设计取舍（与后端 functions/lib/turnstile.js 的「不挡站」对齐）：
//   · **未配置 sitekey ⇒ 直接返回空 token**：后端在没配 secret 时同样放行，
//     两侧都不配 ⇒ 行为与改动前完全一致（等价无操作）。
//   · **脚本加载失败 / 超时 ⇒ 返回空 token**：宁可让后端按「无 token」判，
//     也不要把顾客卡在「验证组件加载中」的状态里。
//   · 只在**写接口**取 token（createOrder / createSubmission / addPublicReview），
//     读接口不碰 —— 与后端 needsCaptcha 同名三件。

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const WRITE_ACTIONS: ReadonlySet<string> = new Set(['createOrder', 'createSubmission', 'addPublicReview'])
const TOKEN_TIMEOUT_MS = 8000

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null
let widgetId: string | null = null
let container: HTMLElement | null = null
let resolveToken: ((token: string) => void) | null = null

function sitekey(): string {
  const k = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_TURNSTILE_SITEKEY
  return typeof k === 'string' && k ? k : ''
}

export function isCaptchaAction(action: string): boolean {
  return WRITE_ACTIONS.has(action)
}

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no-document')); return }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('turnstile-script-failed'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container
  const host = document.createElement('div')
  host.id = 'cf-turnstile-host'
  // 隐式验证：组件不可见但不阻断布局（position:fixed 移出视口）
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:80px;'
  document.body.appendChild(host)
  container = host
  return host
}

function renderWidget(): void {
  const api = window.turnstile
  if (!api) throw new Error('turnstile-api-missing')
  widgetId = api.render(ensureContainer(), {
    sitekey: sitekey(),
    size: 'flexible',
    callback: (token: string) => { const r = resolveToken; resolveToken = null; if (r) r(token) },
    'error-callback': () => { const r = resolveToken; resolveToken = null; if (r) r('') },
    'timeout-callback': () => { const r = resolveToken; resolveToken = null; if (r) r('') },
  })
}

/**
 * 取一个 Turnstile token。**任何失败都返回空串**（由后端决定是否放行）。
 * 上层无需 try/catch —— 刻意设计：验证不可用不该阻断下单。
 */
export async function getCaptchaToken(timeoutMs: number = TOKEN_TIMEOUT_MS): Promise<string> {
  if (!sitekey()) return ''
  if (typeof window === 'undefined') return ''
  try {
    await loadScript()
    if (!window.turnstile) return ''
    if (widgetId == null) renderWidget()
    else window.turnstile.reset(widgetId)
    return await new Promise<string>((resolve) => {
      resolveToken = resolve
      setTimeout(() => { const r = resolveToken; resolveToken = null; if (r) r('') }, timeoutMs)
    })
  } catch {
    return ''
  }
}
