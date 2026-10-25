import React, { useState, useEffect } from 'react'
import { loginAdmin, verifyAdminKey } from '../auth'
import { IS_CLOUD } from '../cloudbase'

/** 门面品牌位：BrandMark 的 inverse 形态（森林绿底上用），懒加载不进 AdminPage chunk 的办法
 *  是直接静态引——BrandMark 本来就在 workspace chunk 里，登录墙是它同一棵树。 */
function BrandLockupInverse() {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full border border-[rgb(217_177_102/0.4)] bg-[rgb(217_177_102/0.12)] text-lg">🛒</span>
      <span className="flex flex-col">
        <strong className="text-[17px] font-extrabold tracking-[-0.04em] text-[#f4efe7]">超柿 <span className="text-[#d9b166]">·</span> 江科一站通</strong>
        <span className="text-[9px] tracking-[0.1em] text-[#9fb0a6]">SUPERMARKET OPS CONSOLE</span>
      </span>
    </div>
  )
}

interface AdminGuardProps {
  children: React.ReactNode
}

export default function AdminGuard({ children }: AdminGuardProps) {
  const [key, setKey] = useState('')
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  // P2#17: 刷新后自动恢复登录态
  useEffect(() => {
    if (!IS_CLOUD) { setChecking(false); return }
    const cached = sessionStorage.getItem('sm_admin_key')
    if (cached) {
      verifyAdminKey(cached).then(ok => {
        if (ok) setAuthed(true)
        setChecking(false)
      }).catch(() => setChecking(false))
    } else {
      setChecking(false)
    }
  }, [])

  if (!IS_CLOUD) return children
  if (checking) return <div className="flex items-center justify-center min-h-full text-stone-500" role="status" aria-live="polite">验证中...</div>
  if (authed) return children

  const handleLogin = async () => {
    if (!key.trim()) return setError('请输入管理密钥')
    setChecking(true)
    setError('')
    try {
      const ok = await loginAdmin(key.trim())
      if (ok) return setAuthed(true)
      setError('密钥错误')
    } catch (e) {
      setError('验证失败：' + (e instanceof Error ? e.message : '网络错误'))
    } finally {
      setChecking(false)
    }
  }

  // 登录墙与 AdminPage 的 main 互斥（if (!authed) 直接 return），所以这个态也得有
  // 自己的 main —— 否则 cloud 模式下「跳到主要内容」无处可跳。
  // 视觉（2026-10-25 第 88 轮）：「账房门厅」—— 后台是店里的账房，登录 = 上工签到。
  // 桌面双栏：左 = 森林绿门面（与 workspace-rail 同一渐变木料，宋体刊头）；右 = 签到牌
  // （工单底稿同族，装订缘 + 铜缘密钥框）。全部可访问锚点（管理密钥/进入后台/验证中）
  // 原文保留，adminGuard.test 8 用例 + stub 5 套 e2e 不动。
  return (
    <div role="main" id="main-content" tabIndex={-1} className="gate-hall">
      {/* 左：账房门面 */}
      <div className="gate-face">
        <div className="gate-face-brand"><BrandLockupInverse /></div>
        <div className="gate-face-title">
          <p className="eyebrow" style={{ color: '#d9b166' }}>江科一站通 · 经营侧</p>
          {/* 「管理后台」heading 由签到牌的 h1 承担（heading-structure 闸一页一个 h1），
              门面这行是展示字不是标题 */}
          <p className="gate-cn" aria-hidden="true">夜里<span>也要</span><br />算得清楚。</p>
          <p>后半夜的订单、明早要送的货、这个月攒下的口碑 —— 都从这一把密钥开始。</p>
        </div>
        <div className="gate-face-foot">
          <span><i aria-hidden="true">◆</i>超柿收银 · 账房</span>
          <span><i aria-hidden="true">◆</i>密钥由 Cloudflare Pages 环境变量下发 · 本站不存明文</span>
        </div>
      </div>

      {/* 右：签到牌 */}
      <div className="gate-sign">
        <div className="gate-plate intake-sheet p-6 animate-fade-in-up">
          <div className="intake-head">
            <i aria-hidden="true">◆</i>
            <h1 className="intake-head-title">管理后台</h1>
            <span aria-hidden="true">Sign in</span>
          </div>
          <p className="mb-5 text-xs text-stone-500">请输入管理密钥以继续</p>

          <label htmlFor="admin-key-input" className="eyebrow block text-stone-500">
            管理密钥
          </label>
          <div className="gate-key mt-2 mb-3">
            <input
              id="admin-key-input"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              aria-label="管理密钥"
              autoFocus
              className="input-base font-mono tracking-widest"
            />
          </div>
          <div role="alert" aria-live="assertive">
            {error && (
              <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
          <button
            onClick={handleLogin}
            disabled={checking}
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {checking ? '验证中...' : '进入后台'}
          </button>
        </div>
      </div>
    </div>
  )
}
