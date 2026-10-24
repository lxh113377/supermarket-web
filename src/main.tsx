import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import InstallPrompt from './components/InstallPrompt'
import { initSubmissionSync } from './db'
import './index.css'
import './redesign.css'

// PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

// 启动离线提交队列同步（网络恢复自动重试 + 首屏补刷）
initSubmissionSync()

// 昼/夜主题首帧落位（v3）：在 React 挂载前把 localStorage 里的选择写到 <html>，
// 避免刷新时先闪一帧默认主题再跳变。CSP 禁内联脚本，故放在入口模块顶层。
try {
  if (localStorage.getItem('sm_theme') === 'night') {
    document.documentElement.setAttribute('data-theme', 'night')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#241E19')
  }
} catch { /* localStorage 不可用时按默认昼主题 */ }

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element not found')

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <InstallPrompt />
    </HashRouter>
  </React.StrictMode>,
)
