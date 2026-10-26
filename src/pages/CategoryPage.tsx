import { useParams, useNavigate } from 'react-router-dom'
import { CATEGORIES } from '../data/categories'
import { getCategoryById, getServicesByCategory } from '../data/services'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import GlyphIcon from '../components/brand/GlyphIcon'
import { resolveCampusPrintUrl } from './print/printApp'
import type { Service } from '../types'

/**
 * 分类页 = 「柜台台账」（2026-10-26 第二轮八维打磨）。
 * 旧版是通用卡片网格：emoji 灰方块 + 窄列悬空 + 通用琥珀警告框，与首页的
 * 色块横带/价签/台账语言完全脱节（桌面端观感廉价的最后一块洼地）。
 * 现在每个分类是一处柜台：封面带挂「COUNTER No.0X」铜牌，服务逐条记进
 * 台账行（铜序号码 + 发光暖台图标 + 金线左轨），闭店提示换成挂牌腔，
 * 页脚一条「其他柜台」横轨把四个分类串成环。形状/曲线/色槽全部用在册件。
 */
export default function CategoryPage() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const category = categoryId ? getCategoryById(categoryId) : undefined
  const services = categoryId ? getServicesByCategory(categoryId) : []
  const open = useBusinessHours()
  const counterNo = category ? CATEGORIES.findIndex((c) => c.id === category.id) + 1 : 0
  const others = category ? CATEGORIES.filter((c) => c.id !== category.id) : []

  const openService = (service: Service) => {
    if (service.type === 'supermarket') {
      navigate('/shop', { state: { fromCategory: true } })
    } else if (service.type === 'print') {
      // 打印 = 本站的校园打印应用本体（public/print/index.html）。直接整页进它，
      // 不走 hash 路由 #/print 那块零内容跳板：少一次渲染、少一帧空白。
      // 地址必须过 resolveCampusPrintUrl()，**不许写死字面量**（2026-10-23 一手）：
      // 从前这里硬写 '/print/'，于是 ① 运营在 CI 里配的 VITE_CAMPUS_PRINT_URL 对本页
      // 完全失效（同一件事两处口径，文档只说了其中一处），② 少带 #print ⇒ 顾客落在
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
      {/* 柜台封面带：与首页封面同一套形状（顶部品牌色带 + 右下切角），
          渐变两端白字过 AA 的口径在 data/categories.ts 头注释。 */}
      <div className={`cover-clip cover-band relative overflow-hidden bg-gradient-to-r ${category.color} px-5 pt-9 pb-14 sm:px-8`}>
        <span aria-hidden="true" className="brand-bar absolute inset-x-0 top-0 h-1" />
        <div className="relative z-10 mx-auto flex max-w-3xl items-center gap-4 sm:gap-6">
          <button
            onClick={() => navigate('/')}
            aria-label="返回"
            className="cover-band-back w-9 h-9 rounded-full bg-panel/15 backdrop-blur-sm flex items-center justify-center"
          >
            ←
          </button>
          {/* 文本块保持内容宽（不 flex-1）：对比度闸按元素盒中心取渐变底色，
              拉满宽会让中心落到 via 段（琥珀带 4.48:1 实测红过，2026-10-26）。 */}
          <div className="animate-fade-in-up min-w-0">
            <p className="counter-eyebrow">
              COUNTER No.{String(counterNo).padStart(2, '0')}
            </p>
            <h1 className="flex items-center gap-2.5 font-serifcn text-display-lg leading-tight">
              <span aria-hidden="true" className="text-2xl"><GlyphIcon glyph={category.icon} /></span>
              {category.name}
            </h1>
            <p className="cover-band-sub mt-2 text-xs">{category.description}</p>
          </div>
        </div>
      </div>

      {/* 闭店挂牌：铜左轨 + 琥珀槽，形状是挂在柜台边的木牌，不是通用警告框 */}
      {!open && (
        <div className="mx-5 -mt-6 relative z-10 max-w-3xl md:mx-auto animate-fade-in-up stagger-1">
          <p className="counter-sign">
            <span aria-hidden="true">⚠️</span> {getClosedMessage()}
          </p>
        </div>
      )}

      {/* 服务台账行：铜序号 + 发光暖台图标 + 金线左轨；桌面两列、手机单列 */}
      <div className={`px-5 max-w-3xl mx-auto pb-12 ${open ? '-mt-6' : 'mt-4'}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map((service, i) => (
            <button
              key={service.id}
              onClick={() => openService(service)}
              className={`counter-row card-interactive w-full p-4 flex items-start gap-3.5 text-left animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}
            >
              <span aria-hidden="true" className="counter-no">{String(i + 1).padStart(2, '0')}</span>
              <span aria-hidden="true" className="counter-stage"><GlyphIcon glyph={service.icon} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink text-sm">{service.name}</span>
                  <span className="counter-arrow text-brand-300" aria-hidden="true">›</span>
                </span>
                <span className="block text-xs text-mute mt-1 leading-relaxed">{service.description}</span>
                {service.hint ? (
                  <span className="block text-xs text-brand-300 mt-1.5 whitespace-pre-line leading-relaxed">{service.hint}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>

        {/* 页脚横轨：四个柜台串成环，桌面不再是一片悬空窄列 */}
        <div className="counter-exit mt-9 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="text-xs text-mute">其他柜台</span>
          {others.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/category/${c.id}`)}
              className="counter-exit-link"
            >
              <span aria-hidden="true" className="counter-exit-glyph"><GlyphIcon glyph={c.icon} /></span>
              {c.name}
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
