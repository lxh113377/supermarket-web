import { useParams, useNavigate } from 'react-router-dom'
import { getCategoryById, getServicesByCategory } from '../data/services'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { resolveCampusPrintUrl } from './print/printApp'
import type { Service } from '../types'

export default function CategoryPage() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const category = categoryId ? getCategoryById(categoryId) : undefined
  const services = categoryId ? getServicesByCategory(categoryId) : []
  const open = useBusinessHours()

  const openService = (service: Service) => {
    if (service.type === 'supermarket') {
      navigate('/shop', { state: { fromCategory: true } })
    } else if (service.type === 'print') {
      // 打印 = 本站的校园打印应用本体（public/print/index.html）。直接整页进它，
      // 不走 hash 路由 #/print 那块零内容跳板：少一次渲染、少一帧空白。
      // 地址必须过 resolveCampusPrintUrl()，**不许写死字面量**（2026-10-23 一手）：
      // 从前这里硬写 '/print/'，于是 ① 运营在 CI 里配的 VITE_CAMPUS_PRINT_URL 对本页
      // 完全失效（同一件事两处口径，文档只说了其中一处），② 少带 `#print` ⇒ 顾客落在
      // 应用**首页**（「文件准备好，打印送到寝室」）而不是下单表单，还得再点一次
      // 「上传文件去打印」。默认值 '/print/#print' 本身就是直达下单视图（实测：带 #print
      // 页面里直接出现「文件与打印设置」+「确认并创建订单」）。跨域兜底已由该解析器
      // 判非法并回落同源路径（见 printApp.ts 的头注），所以这里不需要再防一次。
      window.location.assign(resolveCampusPrintUrl())
    } else {
      navigate(`/service/${service.id}`)
    }
  }

  if (!category) {
    return (
      <div role="main" id="main-content" tabIndex={-1} className="page-container flex items-center justify-center">
        <p className="text-stone-500 text-sm">分类不存在</p>
      </div>
    )
  }

  return (
    <div role="main" id="main-content" tabIndex={-1} className="page-container">
      {/* Header - 分类专属渐变 */}
      {/* 头部（2026-10-22 设计升级）：旧版是"两个半透明白圆"漂浮 —— 那是与本站
          无关的通用装饰。现在换成与首页封面同一套语言：顶部品牌色带 + 右下切角，
          形状全站统一，一眼是同一个产品。渐变色由 data/categories.ts 提供，
          其两端都保证白字过 AA（口径见该文件头注释）。 */}
      <div className={`cover-clip relative overflow-hidden bg-gradient-to-r ${category.color} text-white px-5 pt-9 pb-14 sm:px-8`}>
        <span aria-hidden="true" className="brand-bar absolute inset-x-0 top-0 h-1" />
        <div className="relative z-10 mx-auto flex max-w-lg items-center gap-4">
          <button
            onClick={() => navigate('/')}
            aria-label="返回"
            className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-white/25 transition-all duration-200 active:scale-90"
          >
            ←
          </button>
          <div className="animate-fade-in-up">
            <h1 className="flex items-center gap-2 text-display-md leading-tight">
              <span className="text-2xl">{category.icon}</span>
              {category.name}
            </h1>
            <p className="mt-1.5 text-xs text-white/85">{category.description}</p>
          </div>
        </div>
      </div>

      {/* 非营业时间提示 */}
      {!open && (
        <div className="mx-5 -mt-6 relative z-10 max-w-lg md:mx-auto animate-fade-in-up stagger-1">
          <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200/80 rounded-2xl p-3.5 shadow-card">
            <p className="text-amber-800 text-xs flex items-center gap-2">
              <span>⚠️</span> {getClosedMessage()}
            </p>
          </div>
        </div>
      )}

      {/* 服务列表 - 生活板块两列网格，其余分类单列 */}
      <div className={`px-5 max-w-lg mx-auto pb-10 ${open ? '-mt-6' : 'mt-4'}`}>
        {category.id === 'life' ? (
          <div className="grid grid-cols-2 gap-3.5">
            {services.map((service, i) => (
              <button
                key={service.id}
                onClick={() => openService(service)}
                className={`card-interactive w-full p-4 flex flex-col items-start gap-2.5 text-left animate-fade-in-up stagger-${i + 1}`}
              >
                <span className="text-2xl w-11 h-11 flex items-center justify-center bg-gray-50 rounded-xl">{service.icon}</span>
                <div className="min-w-0 w-full">
                  <p className="font-semibold text-ink-soft text-sm truncate">{service.name}</p>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed line-clamp-2">{service.description}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3.5">
            {services.map((service, i) => (
              <button
                key={service.id}
                onClick={() => openService(service)}
                className={`card-interactive w-full p-5 flex items-center gap-4 text-left animate-fade-in-up stagger-${i + 1}`}
              >
                <span className="text-3xl flex-shrink-0 w-12 h-12 flex items-center justify-center bg-gray-50 rounded-xl">
                  {service.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-soft text-sm">{service.name}</p>
                  <p className="text-xs text-stone-500 mt-1 truncate leading-relaxed">{service.description}</p>
                </div>
                <span className="text-stone-400 text-xl transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
