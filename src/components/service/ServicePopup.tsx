
import Overlay from '../Overlay'
import GlyphIcon from '../brand/GlyphIcon'

// 服务表单页弹窗（M6 拆分自 ServiceFormPage，2026-09-05）
// 2026-09-23：改用统一 Overlay —— 保留 dialog + aria-modal + Esc 关闭语义，
// 并补齐原实现缺失的焦点陷阱 / 焦点归还 / 背景滚动锁。

export default function ServicePopup({ popup, onClose }: { popup: string; onClose: () => void }) {
  return (
    <Overlay open onClose={onClose} label="温馨提示" className="rounded-3xl p-7">
      <div className="text-center">
        {/* 牌托换成暖台 + 自绘线稿（旧版 = brand-50 灰块里悬一枚 emoji） */}
        <div className="hint-plate hint-plate-large mx-auto mb-4">
          <GlyphIcon glyph="📋" />
        </div>
        <h2 className="font-bold text-ink text-lg">温馨提示</h2>
        <p className="text-stone-500 text-sm mt-3 leading-relaxed">{popup}</p>
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
