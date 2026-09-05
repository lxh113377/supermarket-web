import React from 'react'

// 服务表单页弹窗（M6 拆分自 ServiceFormPage，2026-09-05）
// P0-12 语义保留：dialog + aria-modal + Esc 关闭。

export default function ServicePopup({ popup, onClose }: { popup: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="温馨提示"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-5 animate-fade-in"
    >
      <div className="bg-white rounded-3xl p-7 max-w-sm w-full shadow-float animate-scale-in">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brand-50 flex items-center justify-center">
            <span className="text-3xl">📋</span>
          </div>
          <h3 className="font-bold text-gray-900 text-lg">温馨提示</h3>
          <p className="text-gray-500 text-sm mt-3 leading-relaxed">{popup}</p>
        </div>
        <button
          onClick={onClose}
          autoFocus
          className="mt-6 btn-primary w-full py-3.5"
        >
          我知道了
        </button>
      </div>
    </div>
  )
}