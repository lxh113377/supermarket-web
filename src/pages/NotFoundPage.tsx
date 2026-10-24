import { useNavigate } from 'react-router-dom'
import { IconEmpty } from '../components/Icons'

/**
 * 404（2026-10-22 设计升级）。
 * 旧版那颗圆是随机感渐变（黄→绿直调），与站内任何一块色都不成体系；
 * 现在改用首页封面的同一语言：柿色渐变 + 右下切角，"走丢了"也在这套品牌里。
 * 数字用展示体（Bricolage）压成水印级灰阶 —— 它是**图形不是正文**：
 * 88px 超大字号、语义完全由下面那行「页面走丢了」承载，读它的人不需要
 * 靠这个 404 得知任何信息。所以低对比是设计意图，用 data-decorative 显式声明。
 *
 * 为什么是 data-decorative 而不是只挂 aria-hidden（2026-10-23 更正）：
 * aria-hidden 的语义是"对辅助技术隐藏"，而对比度判据管的是**肉眼可见**的东西；
 * 拿它当装饰代理判据会让真可见的文字漏检（一手事故：订单进度条序号
 * 挂了 aria-hidden 却肉眼可见，gray-500 压 gray-100 = 4.39:1 从来没被扫过）。
 * 装饰豁免必须有，但只能是作者**显式说**的，不能由判据从别的属性猜。
 */
export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div role="main" id="main-content" tabIndex={-1} className="page-container paper-grain flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div
        aria-hidden="true"
        className="cover-clip relative mb-8 flex h-20 w-20 items-center justify-center"
        style={{ background: 'linear-gradient(155deg, #d9b166, #b18739 62%, #7a5c20)' }}
      >
        <IconEmpty className="h-9 w-9 text-ink" />
      </div>

      <p aria-hidden="true" data-decorative="true" className="price-num select-none text-[5.5rem] font-extrabold leading-none text-stone-200">
        404
      </p>
      {/* 装饰大字 404 的色温也要跟上：gray-200 实测 b*=-2.18，正好压在暖前景判据的冷阈值
          之下（|b*|<1.2 才算中性豁免）。虽然它 aria-hidden + data-decorative（零信息字符，
          按判据口径可豁免），但 5.5rem 的字压在暖白页底上，色温不对就是看得见的蓝灰边。
          stone-200 与 gray-200 的 L* 只差 0.5（91.6 → 91.1），视觉亮度不变。── */}
      <h1 className="-mt-3 text-display-md text-ink">页面走丢了</h1>
      <p className="mt-2 text-sm text-stone-500">这个地址不存在，可能已被移动或删除。</p>

      <button
        onClick={() => navigate('/')}
        className="btn-primary mt-8 px-7 py-3 text-sm"
      >
        返回首页
      </button>

      <span aria-hidden="true" className="brand-bar mt-12 h-0.5 w-12 rounded-full opacity-60" />
    </div>
  )
}
