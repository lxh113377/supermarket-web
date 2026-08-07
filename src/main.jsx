import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { initSubmissionSync } from './db.js'
import './index.css'

// 全局错误上报（静默，不影响用户体验）
function reportError(message, source) {
  try {
    const apiBase = import.meta.env.VITE_CB_API_BASE
    if (!apiBase) return
    navigator.sendBeacon(apiBase, JSON.stringify({
      action: 'createSubmission',
      payload: {
        serviceId: '_error_report',
        serviceName: '前端错误上报',
        categoryId: 'system',
        categoryName: '系统',
        formData: {
          message: String(message).slice(0, 200),
          source: String(source || '').slice(0, 100),
          url: location.href.slice(0, 200),
          ua: navigator.userAgent.slice(0, 100),
          time: new Date().toISOString(),
        },
      },
    }))
  } catch {}
}

window.addEventListener('error', (e) => {
  reportError(e.message, e.filename + ':' + e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  reportError(String(e.reason?.message || e.reason), 'unhandledrejection')
})

// PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

// 启动离线提交队列同步（网络恢复自动重试 + 首屏补刷）
initSubmissionSync()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
