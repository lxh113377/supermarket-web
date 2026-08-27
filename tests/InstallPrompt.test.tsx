// @vitest-environment jsdom
// InstallPrompt 微信浏览器分支：微信无 beforeinstallprompt 事件，应显示手动引导条（右上角 ··· 添加到主屏幕/桌面），
// 且不出现系统弹窗「立即添加」按钮。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import InstallPrompt from '../src/components/InstallPrompt'

function mockUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

// 微信 iOS：右上角 ··· → 添加到主屏幕
const WX_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.38 NetType/WIFI Language/zh_CN'
// 微信 Android：右上角 ··· → 添加到桌面
const WX_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.38 NetType/WIFI Language/zh_CN'
// 标准 Chrome（应有 beforeinstallprompt，但 jsdom 无该事件 → 走「其他环境不打扰」，不显示）
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'

function renderInRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <InstallPrompt />
    </MemoryRouter>,
  )
}

describe('InstallPrompt 微信引导', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    // jsdom 默认 UA 不是微信/Chrome 真实环境，重置为标准
    mockUA(CHROME)
  })
  afterEach(() => {
    cleanup()
  })

  it('微信 iOS：显示「添加到主屏幕」手动引导，无系统弹窗按钮', () => {
    mockUA(WX_IOS)
    renderInRouter()
    expect(screen.getByText('添加到主屏幕')).toBeTruthy() // 标题
    expect(screen.getByText(/选择「添加到主屏幕」/)).toBeTruthy() // 引导文案
    expect(screen.queryByText('立即添加')).toBeNull() // 无 beforeinstallprompt → 无系统弹窗按钮
  })

  it('微信 Android：显示「添加到桌面」手动引导', () => {
    mockUA(WX_ANDROID)
    renderInRouter()
    expect(screen.getByText(/添加到桌面/)).toBeTruthy()
    expect(screen.queryByText('立即添加')).toBeNull()
  })

  it('非微信非 iOS 环境不打扰（不显示引导条）', () => {
    mockUA(CHROME)
    renderInRouter()
    expect(screen.queryByText('添加到主屏幕')).toBeNull()
  })
})
