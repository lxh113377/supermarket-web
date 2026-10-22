import { useNavigate } from 'react-router-dom'
import { IconEmpty } from '../components/Icons'

/**
 * 404（2026-10-22 设计升级）。
 * 旧版那颗圆是随机感渐变（黄→绿直调），与站内任何一块色都不成体系；
 * 现在改用首页封面的同一语言：柿色渐变 + 右下切角，"走丢了"也在这套品牌里。
 * 数字用展示体（Bricolage）压成水印级灰阶 —— 它是图形不是正文，
 * 承担构图而非信息，所以低对比是设计意图（aria-hidden 已标）。
 */
export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="page-container paper-grain flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div
        aria-hidden="true"
        className="cover-clip relative mb-8 flex h-20 w-20 items-center justify-center"
        style={{ background: 'linear-gradient(155deg, #fde047, #eab308 70%, #ca8a04)' }}
      >
        <IconEmpty className="h-9 w-9 text-ink" />
      </div>

      <p aria-hidden="true" className="price-num select-none text-[5.5rem] font-extrabold leading-none text-gray-200">
        404
      </p>
      <h1 className="-mt-3 text-display-md text-ink">页面走丢了</h1>
      <p className="mt-2 text-sm text-gray-500">这个地址不存在，可能已被移动或删除。</p>

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
