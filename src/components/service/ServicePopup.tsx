
import Overlay from '../Overlay'

// 服务表单页弹窗（M6 拆分自 ServiceFormPage，2026-09-05）
// 2026-09-23：改用统一 Overlay —— 保留 dialog + aria-modal + Esc 关闭语义，
// 并补齐原实现缺失的焦点陷阱 / 焦点归还 / 背景滚动锁。

export default function ServicePopup({ popup, onClose }: { popup: string; onClose: () => void }) {
  return (
    <Overlay open onClose={onClose} label="温馨提示" className="rounded-3xl p-7">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-brand-50 flex items-center justify-center">
          <span className="text-3xl" aria-hidden="true">📋</span>
        </div>
        <h3 className="font-bold text-gray-900 text-lg">温馨提示</h3>
        <p className="text-gray-500 text-sm mt-3 leading-relaxed">{popup}</p>
      </div>
      <button
        onClick={onClose}
        data-autofocus
        className="mt-6 btn-primary w-full py-3.5"
      >
        我知道了
      </button>
    </Overlay>
  )
}
