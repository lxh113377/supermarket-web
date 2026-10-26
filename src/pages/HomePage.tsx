import { Link } from 'react-router-dom'
import { IconRobot } from '../components/Icons'
import { CATEGORIES } from '../data/categories'
import { MIN_DELIVERY_AMOUNT } from '../data/deliveryLimits'
import { formatPrice, formatYuan } from '../utils/format'
import { products } from '../data/products-seed'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { prefetchRoute } from '../prefetchBus'
import CustomerHeader from '../components/brand/CustomerHeader'
import MarketHero from '../components/brand/MarketHero'

/** 今日货架取数：在售面（enabled !== false）按目录序号升序取头八件。
 *  模块级常量 = 一次求值（seed 是静态数据，不需要 effect 与状态）；
 *  不编销量、不编评分 —— 这一屏只摆**真在卖**的东西，与承诺带那句「真实商品」对齐。
 *  地址用 'p_' + order：与 localStore 补 _id 的同一规则（'p_' + p.order），
 *  所以首页这一件点进去就是商城里那一条记录，不是另造一套 id 口径。 */
const onSale = products.filter((p) => p.enabled !== false && typeof p.order === 'number')
const onSaleCount = onSale.length
const shelf = [...onSale]
  .sort((a, b) => (a.order as number) - (b.order as number))
  .slice(0, 8)
  .map((p) => ({ ...p, order: p.order as number, id: 'p_' + (p.order as number) }))

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
        {/* ── 第四带：今日货架（2026-10-26 第 91 轮）──
            首页原来三带就结束：色块横带 → 服务目录 → 承诺带 → 页脚。而承诺带里写着
            「真实商品」，全站却没有任何一屏把**真实商品**摆给新访客看 —— 想看货必须先进
            商城，等于把最强的资产（65 件实拍在售）藏在一次点击之后。
            这一带把货架抬到首页：一条柜台横轨，商品立在轨上，每件挂一枚价签。
            数据 = products-seed 在售面（enabled !== false）按 order 升序取前 8 件，
            **不编销量、不编库存**（本站口径：屏上每个数字都要有出处）。
            窄档横向可滑（overflow-x-auto，不是 hidden —— 可达闸按「存在一个可见位置」判，
            横滑容器里的件全部可达）；宽档铺成一轨。整件是可点的链接，不内嵌按钮：
            一屏 8 个加购钮会把「逛」变成「操作」，且触控/按压两条判据的面翻倍。 */}
        <section className="home-shelf" aria-labelledby="shelf-title">
          <div className="home-shelf-head">
            <div>
              <p className="eyebrow">TODAY ON THE SHELF</p>
              <h2 id="shelf-title" className="home-shelf-title">今日货架</h2>
            </div>
            <p className="home-shelf-note">
              在售 <b className="price-num">{onSaleCount}</b> 件 · 这里是刚上到的头八件
              <span aria-hidden="true"> →</span>
            </p>
          </div>
          <div className="home-shelf-rail">
            {shelf.map((p, i) => (
              <Link
                key={p.id}
                to={'/product/' + p.id}
                onMouseEnter={() => prefetchRoute('product')}
                onFocus={() => prefetchRoute('product')}
                /* animate-fade-in-up 不能省：stagger-N 只写 animation-delay，
                   元素本体没有 animation 时那个 delay 是**惰性的**（本轮一直在修的
                   「写了等于没写」那一族，自己差点又写一遍）。 */
                className={'home-shelf-item animate-fade-in-up stagger-' + Math.min(i + 1, 8)}
                aria-label={'看 ' + p.name + ' 详情，' + formatYuan(p.price)}
              >
                <span aria-hidden="true" className="counter-no">{String(p.order).padStart(2, '0')}</span>
                {/* 价签挂在**照片**右下角（第一版挂在条目底部，两行商品名被压住半行 ——
                    目检截图实测）。牌是货架上的牌，它属于货，不属于文字。 */}
                <span className="home-shelf-photo">
                  <img
                    src={'/images/sm/' + p.order + '.webp'}
                    srcSet={'/images/sm/' + p.order + '.webp 400w, /images/' + p.order + '.webp 800w'}
                    sizes="(max-width: 639px) 42vw, 168px"
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                    alt={p.name + ' 商品摄影'}
                  />
                  <span className="home-shelf-tag price-num">
                    <span className="home-shelf-yuan" aria-hidden="true">¥</span>{formatPrice(p.price)}
                  </span>
                </span>
                <span className="home-shelf-name">{p.name}</span>
              </Link>
            ))}
          </div>
          <Link to="/shop" className="home-shelf-exit text-link">看完整货架 <span aria-hidden="true">↗</span></Link>
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
