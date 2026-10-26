import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBusinessHoursText } from '../../utils/businessHours'
import { MIN_DELIVERY_AMOUNT } from '../../data/deliveryLimits'
import { formatYuan } from '../../utils/format'
import { prefetchRoute } from '../../prefetchBus'
import { pickExhibits } from '../../data/pick-exhibits'
import { products } from '../../data/products-seed'

/** 开屏三件每次随机：模块加载时抽一次（一次页面会话内稳定，刷新/再开屏换新）。
 *  池子 = seed 全量零食（subcategories 含 snacks 的在售面），图源 /images/{order}.webp 全量在册。
 *  窄档（≤900px，与 CSS 藏卡片的断点同一个数）拍立得两件并排是设计定式 ⇒ 抽 5 件，
 *  宽档用前 3、窄档用前 2（同一次随机源，刷新前两边看到的组合同源不同数，
 *  避免 CSS 藏卡片造成「内容存在但不可见」的判红）。 */
const allExhibits = pickExhibits(
  products.filter((p) => (p.subcategories || []).includes('snacks')),
)

export default function MarketHero({ open }: { open: boolean }) {
  const visualRef = useRef<HTMLDivElement>(null)
  /* 件数判定必须与 redesign.css 里 `.exhibit-side { display: none }` 的断点**同一个数**。
     旧写法两处都是 767，而 CSS 那条挂在 @media (max-width: 900px) 块里 ⇒ 768–900px 之间
     JS 渲染三件、CSS 把第三件藏掉 —— 内容存在而不可见（本仓明令禁止的形态，
     「零面积叶会被可达闸判红」的同族）。这里把 JS 侧对齐到 900，两边同判两件。 */
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 900px)')
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const exhibits = narrow ? allExhibits.slice(0, 2) : allExhibits.slice(0, 3)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 900px)').matches) return
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
        {/* 首句保留平台定位句：既是给新访客的一句话定位，也是 e2e 冒烟的语义锚（tests/e2e/smoke.spec.ts） */}
        <p className="market-intro">一站式校园生活服务平台——零食、饮料与生活所需。<br />下楼之前，先替你送到楼下。</p>
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
        <span className="showcase-sticker" aria-hidden="true" data-decorative="true">今日<br />有好柿</span>
        <span className="showcase-orbit" aria-hidden="true" data-decorative="true" />
        <span className="showcase-word" aria-hidden="true" data-decorative="true">超柿</span>
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
