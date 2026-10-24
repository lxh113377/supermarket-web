import { Link } from 'react-router-dom'

export default function BrandMark({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <Link to="/" className={`brand-lockup ${inverse ? 'brand-lockup-inverse' : ''}`} aria-label="江科一站通首页">
      <span className="brand-fruit" aria-hidden="true"><span>柿</span></span>
      <span className="brand-wordmark">
        <strong>超柿</strong>
        {!compact && <span><span className="brand-campus">江科一站通</span><span className="brand-dot"> / </span>校园日常服务站</span>}
      </span>
    </Link>
  )
}
