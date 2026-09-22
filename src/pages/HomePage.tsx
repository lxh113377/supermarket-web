import { useNavigate } from 'react-router-dom'
import { CATEGORIES } from '../data/categories'
import { isBusinessHours, getClosedMessage, getBusinessHoursText } from '../utils/businessHours'
import { IconRobot } from '../components/Icons'
import { prefetchRoute } from '../routeLoaders'

export default function HomePage() {
  const navigate = useNavigate()
  const open = isBusinessHours()

  return (
    <div className="page-container">
      {/* Header - 更精致的渐变 + 呼吸感 */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white px-6 pt-12 pb-16">
        {/* 装饰性背景圆 */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white/5" />
        <div className="relative z-10 text-center">
          <h1 className="text-2xl font-bold tracking-wide animate-fade-in-up">江科一站通</h1>
          <p className="text-white/80 mt-2 text-sm font-light animate-fade-in-up stagger-1">一站式校园生活服务平台</p>
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-sm text-xs text-white/90 animate-fade-in-up stagger-2">
            <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-green-300' : 'bg-amber-300'}`} />
            {getBusinessHoursText()}
          </div>
        </div>
      </div>

      {/* 非营业时间提示 */}
      {!open && (
        <div className="mx-5 -mt-8 relative z-10 animate-fade-in-up stagger-2">
          <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200/80 rounded-2xl p-4 shadow-card">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">⚠️</span>
              <div>
                <p className="text-amber-800 font-medium text-sm">非营业时间</p>
                <p className="text-amber-600 text-xs mt-1 leading-relaxed">{getClosedMessage()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 四大分类 - 交错入场 + 悬浮交互 */}
      {/* 响应式：手机 2 列 → 平板/桌面 4 列（原实现恒为 2 列，大屏两侧大量留白） */}
      <div
        className={`px-5 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto ${
          open ? '-mt-8' : 'mt-5'
        }`}
      >
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.id}
            onClick={() => navigate(`/category/${cat.id}`)}
            // hover / 键盘聚焦时预取目标路由 chunk（用户意图已出现，趁点击前加载完）
            onMouseEnter={() => prefetchRoute('category')}
            onFocus={() => prefetchRoute('category')}
            aria-label={`查看${cat.name}`}
            className={`card-interactive p-6 flex flex-col items-center gap-3 animate-fade-in-up stagger-${i + 1}`}
          >
            <span aria-hidden="true" className="text-4xl drop-shadow-sm transition-transform duration-300 group-hover:scale-110">{cat.icon}</span>
            <span className="font-semibold text-gray-800 text-sm">{cat.name}</span>
            <span className="text-xs text-gray-400 leading-snug">{cat.description}</span>
          </button>
        ))}
      </div>

      {/* 底部信息 */}
      <div className="text-center mt-12 pb-10 px-4 animate-fade-in stagger-5">
        <div className="w-8 h-0.5 bg-gray-200 rounded-full mx-auto mb-4" />
        <p className="text-xs text-gray-400 tracking-wide">江西科技学院 · 校园服务平台</p>
      </div>

      {/* AI 导购浮窗入口：底部位置统一走 .safe-offset-bottom（原先内联 style 又写了一遍安全区） */}
      <button
        onClick={() => navigate('/assistant')}
        onMouseEnter={() => prefetchRoute('assistant')}
        onFocus={() => prefetchRoute('assistant')}
        aria-label="打开 AI 导购助手"
        className="safe-offset-bottom fixed right-4 z-30 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full brand-bar text-white shadow-float transition-all duration-200 active:scale-[0.95] animate-slide-up"
      >
        <IconRobot className="w-5 h-5" />
        <span className="text-xs font-semibold tracking-wide">AI 导购</span>
      </button>
    </div>
  )
}
