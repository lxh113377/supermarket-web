import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="text-4xl mb-4">😵</div>
          <h2 className="text-lg font-bold mb-2">页面出了点问题</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-xs">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="bg-brand-500 text-white px-6 py-2 rounded-lg text-sm"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
