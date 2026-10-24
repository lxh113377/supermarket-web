import { Link } from 'react-router-dom'
import { CATEGORIES } from '../data/categories'
import { getClosedMessage } from '../utils/businessHours'
import { MIN_DELIVERY_AMOUNT } from '../data/deliveryLimits'
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
      <span className="sr-only">零食饮料满 {MIN_DELIVERY_AMOUNT} 元起送</span>
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
              return <Link key={cat.id} to={`/category/${cat.id}`} onMouseEnter={() => prefetchRoute('category')} onFocus={() => prefetchRoute('category')} className="service-directory-item">
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
        <span>江西科技学院 · 校园日常服务站</span>
        <span>日常有味，事事省心。</span>
      </footer>
    </div>
  )
}
