import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getBusinessHoursText } from '../../utils/businessHours'
import { MIN_DELIVERY_AMOUNT } from '../../data/deliveryLimits'
import { formatYuan } from '../../utils/format'
import { prefetchRoute } from '../../prefetchBus'

const exhibits = [
  { order: 38, label: '解馋', sub: '香辣一口', className: 'exhibit-back' },
  { order: 33, label: '咔滋', sub: '快乐开袋', className: 'exhibit-front' },
  { order: 1, label: '清爽', sub: '课间补水', className: 'exhibit-side' },
]

export default function MarketHero({ open }: { open: boolean }) {
  const visualRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 767px)').matches) return
    let frame = 0
    const move = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const y = Math.min(window.scrollY, window.innerHeight)
        visualRef.current?.style.setProperty('--hero-shift', `${y * 0.1}px`)
      })
    }
    window.addEventListener('scroll', move, { passive: true })
    return () => { window.removeEventListener('scroll', move); if (frame) window.cancelAnimationFrame(frame) }
  }, [])

  return (
    <section className="market-hero" aria-labelledby="market-title">
      <div className="market-hero-copy">
        <p className="eyebrow hero-eyebrow"><span className="hero-index">NO. 01</span> 宿舍楼下的日常市集</p>
        <h1 id="market-title" className="market-title">把日常，<br /><span>过得有滋味。</span></h1>
        <p className="market-intro">零食、饮料与生活所需。<br />下楼之前，先替你送到楼下。</p>
        <div className="market-actions">
          <Link to="/shop" className="button button-primary button-large" onMouseEnter={() => prefetchRoute('shop')}>现在，逛点好吃的 <span aria-hidden="true">↗</span></Link>
          <Link to="/order-query" className="text-link">我的订单 <span aria-hidden="true">→</span></Link>
        </div>
        <div className="market-facts">
          <div><span>配送约定</span><strong>满 {formatYuan(MIN_DELIVERY_AMOUNT)} 起送</strong></div>
          <div><span>营业时间</span><strong>{open ? '今天为你开门' : '现在打烊，先看看'}</strong></div>
        </div>
      </div>
      <div className="market-showcase" ref={visualRef}>
        <span className="showcase-sticker" aria-hidden="true">今日<br />有好柿</span>
        <span className="showcase-orbit" aria-hidden="true" />
        <span className="showcase-word" aria-hidden="true">超柿</span>
        <div className="market-exhibits">
          {exhibits.map(item => <figure key={item.order} className={`market-exhibit ${item.className}`}>
            <div className="exhibit-photo"><img src={`/images/${item.order}.webp`} width="800" height="800" alt={`${item.label} · ${item.sub} 商品摄影`} fetchPriority="high" /></div>
            <figcaption><span>{item.label}</span><small>{item.sub}</small></figcaption>
          </figure>)}
        </div>
        <p className="showcase-note"><span aria-hidden="true">↳</span> 商品摄影，所见即所选</p>
      </div>
      <div className="market-hours"><span>OPENING HOURS</span><p>{getBusinessHoursText()}</p><i aria-hidden="true">↘</i></div>
    </section>
  )
}
