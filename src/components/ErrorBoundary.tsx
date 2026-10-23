import React from 'react'
import { IconAlert } from './Icons'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * 兜底错误页：顾客端也会看到（任何页面子组件抛错都渲染它），所以它属于**顾客端色温面**，
 * 不是管理端欠账。2026-10-23 实测发现它一度被漏网 —— 暖色前景判据按路由取样，而正常路由
 * 不会渲染本组件 ⇒ 判据看不见它。补法见 tests/e2e-visual/warm-foreground.spec.ts 的源码棘轮腿。
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="relative mb-5">
            <div className="w-16 h-16 rounded-full brand-bar opacity-25" />
            <div className="absolute inset-0 flex items-center justify-center text-stone-600">
              <IconAlert className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-lg font-bold mb-1">页面出了点问题</h1>
          <p className="text-sm text-stone-500 mb-2 max-w-xs">
            {this.state.error?.message || '未知错误'}
          </p>
          <p className="text-xs text-stone-500 mb-5">别担心，数据都在，重试一下试试。</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="bg-brand-500 text-ink px-6 py-2 rounded-lg text-sm
                         hover:bg-brand-400 transition duration-200 active:scale-[0.97]"
            >
              重试
            </button>
            <a
              href="/"
              className="bg-gray-100 text-stone-700 px-6 py-2 rounded-lg text-sm font-medium
                         hover:bg-gray-200 transition duration-200 active:scale-[0.97]"
            >
              返回首页
            </a>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
