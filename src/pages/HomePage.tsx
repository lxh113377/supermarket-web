import { Link } from 'react-router-dom'
import { IconRobot } from '../components/Icons'
import { CATEGORIES } from '../data/categories'
import { MIN_DELIVERY_AMOUNT } from '../data/deliveryLimits'
import { formatYuan } from '../utils/format'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { prefetchRoute } from '../prefetchBus'
import CustomerHeader from '../components/brand/CustomerHeader'
import MarketHero from '../components/brand/MarketHero'

const categoryNotes: Record<string, { subtitle: string; action: string }> = {
  life: { subtitle: '零食、日常与代拿', action: '照顾日常' },
  entertainment: { subtitle: '课间放松，补充快乐', action: '放松一下' },
  study: { subtitle: '打印与学习小帮手', action: '轻松一点' },
  other: { subtitle: '更多校园服务', action: '发现更多' },
}

export default function HomePage() {
  const open = useBusinessHours()
  return (
    <div className="home-page">
      <CustomerHeader />
      <main id="main-content" tabIndex={-1}>
        <MarketHero open={open} />
        {!open && <aside className="home-closed-note" role="status">
          <span className="closed-note-label">现在打烊</span>
          <p>{getClosedMessage()}</p>
          <Link to="/shop">先逛逛 <span aria-hidden="true">↗</span></Link>
        </aside>}
        <section className="home-services" aria-labelledby="services-title">
          <div className="home-section-heading">
            <p className="eyebrow">EVERYDAY, MADE EASIER</p>
            <h2 id="services-title">校园大小事，<br />一站简单点。</h2>
            <p>不止是解馋。把每天要做的小事，<br />放在离你更近的地方。</p>
          </div>
          <nav className="service-directory" aria-label="服务分类">
            {CATEGORIES.map((cat, index) => {
              const note = categoryNotes[cat.id]
              return <Link key={cat.id} to={`/category/${cat.id}`} onMouseEnter={() => prefetchRoute('category')} onFocus={() => prefetchRoute('category')} className="service-directory-item hover:bg-brand-50">
                <span className="service-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="service-main"><strong>{cat.name}</strong><span>{note.subtitle}</span></span>
                <span className="service-action">{note.action}<span aria-hidden="true">↗</span></span>
              </Link>
            })}
          </nav>
        </section>
        <section className="home-promise" aria-label="服务承诺">
          <p className="eyebrow">FROM OUR SHELF TO YOUR DOOR</p>
          <h2>不用专门跑一趟，<br /><span>日常就近一点。</span></h2>
          <Link to="/shop" className="button button-light button-large">今天，想吃点什么 <span aria-hidden="true">↗</span></Link>
          <div className="promise-footnotes"><span>真实商品</span><span>清晰价格</span><span>宿舍配送</span></div>
        </section>
      </main>
      <footer className="home-footer">
        <span>超柿 <i>×</i> 江科一站通</span>
        {/* 起送门槛在页脚以可见文案落一处（minDeliveryParity 闸要求本页引用常量而非硬编码数字） */}
        <span>零食饮料满 {formatYuan(MIN_DELIVERY_AMOUNT)} 起送</span>
        <span>江西科技学院 · 校园日常服务站</span>
        <span>日常有味，事事省心。</span>
      </footer>
      {/* AI 导购浮钮（v3 形态）：恒定深褐底 + 黄铜圆徽 + 米白字（16.5:1），语义与旧版一致——
          e2e 冒烟按 aria-label 找它，视觉走色块带语言 */}
      <button
        type="button"
        onClick={() => window.location.assign('#/assistant')}
        onMouseEnter={() => prefetchRoute('assistant')}
        onFocus={() => prefetchRoute('assistant')}
        aria-label="打开 AI 导购助手"
        className="ai-float float-cart safe-offset-bottom fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-30 flex animate-slide-up items-center gap-2 rounded-full py-3 pl-3 pr-4 shadow-float"
      >
        <span className="float-cart-chip flex h-7 w-7 items-center justify-center rounded-full">
          {/* 图标色落在 svg 自己身上（contrast 闸按元素 computed color 对元素 rect 底量，
              色在父 span 上会量成深徽压深钮 = 1.14:1 假红） */}
          <IconRobot className="h-4 w-4 text-espresso" />
        </span>
        <span className="text-xs font-semibold tracking-wide">AI 导购</span>
      </button>
    </div>
  )
}
