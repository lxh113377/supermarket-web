import { Link } from 'react-router-dom'
import BrandMark from './BrandMark'
import ThemeToggle from './ThemeToggle'
import { useBusinessHours } from '../../hooks/useBusinessHours'
import { prefetchRoute } from '../../prefetchBus'

export default function CustomerHeader({ minimal = false }: { minimal?: boolean }) {
  const open = useBusinessHours()
  return (
    <header className="site-header">
      <BrandMark />
      <div className="site-header-actions">
        <span className="business-state" role="status"><i aria-hidden="true" />{open ? '营业中' : '已打烊'}</span>
        <ThemeToggle />
        {!minimal && <>
          <Link className="header-link header-order" to="/order-query" onMouseEnter={() => prefetchRoute('orderQuery')}>查询订单</Link>
          <Link className="header-link header-ai" to="/assistant" onMouseEnter={() => prefetchRoute('assistant')} aria-label="打开 AI 导购">AI 导购 <span aria-hidden="true">↗</span></Link>
          <Link className="button button-ink header-shop" to="/shop" onMouseEnter={() => prefetchRoute('shop')}>去逛超市 <span aria-hidden="true">↗</span></Link>
        </>}
        {minimal && <Link className="header-link header-order" to="/shop">返回商城 <span aria-hidden="true">↗</span></Link>}
      </div>
    </header>
  )
}
