import { useParams, useNavigate } from 'react-router-dom'
import { getCategoryById, getServicesByCategory } from '../data/services'
import { isBusinessHours, getClosedMessage } from '../utils/businessHours'

export default function CategoryPage() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const category = categoryId ? getCategoryById(categoryId) : undefined
  const services = categoryId ? getServicesByCategory(categoryId) : []
  const open = isBusinessHours()

  if (!category) {
    return (
      <div className="page-container flex items-center justify-center">
        <p className="text-gray-400 text-sm">分类不存在</p>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header - 分类专属渐变 */}
      <div className={`relative overflow-hidden bg-gradient-to-r ${category.color} text-white px-5 pt-8 pb-14`}>
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute bottom-0 left-1/4 w-20 h-20 rounded-full bg-white/5" />
        <div className="relative z-10 flex items-center gap-4 max-w-lg mx-auto">
          <button
            onClick={() => navigate('/')}
            aria-label="返回"
            className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-white/25 transition-all duration-200 active:scale-90"
          >
            ←
          </button>
          <div className="animate-fade-in-up">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-2xl">{category.icon}</span>
              {category.name}
            </h1>
            <p className="text-white/70 text-xs mt-1">{category.description}</p>
          </div>
        </div>
      </div>

      {/* 非营业时间提示 */}
      {!open && (
        <div className="mx-5 -mt-6 relative z-10 max-w-lg md:mx-auto animate-fade-in-up stagger-1">
          <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200/80 rounded-2xl p-3.5 shadow-card">
            <p className="text-amber-700 text-xs flex items-center gap-2">
              <span>⚠️</span> {getClosedMessage()}
            </p>
          </div>
        </div>
      )}

      {/* 服务列表 - 交错入场 */}
      <div className={`px-5 max-w-lg mx-auto space-y-3.5 pb-10 ${open ? '-mt-6' : 'mt-4'}`}>
        {services.map((service, i) => (
          <button
            key={service.id}
            onClick={() => {
              if (service.type === 'supermarket') {
                navigate('/shop', { state: { fromCategory: true } })
              } else {
                navigate(`/service/${service.id}`)
              }
            }}
            className={`card-interactive w-full p-5 flex items-center gap-4 text-left animate-fade-in-up stagger-${Math.min(i + 1, 6)}`}
          >
            <span className="text-3xl flex-shrink-0 w-12 h-12 flex items-center justify-center bg-gray-50 rounded-xl">
              {service.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-800 text-sm">{service.name}</p>
              <p className="text-xs text-gray-400 mt-1 truncate leading-relaxed">{service.description}</p>
            </div>
            <span className="text-gray-300 text-xl transition-transform duration-200 group-hover:translate-x-0.5">›</span>
          </button>
        ))}
      </div>
    </div>
  )
}
