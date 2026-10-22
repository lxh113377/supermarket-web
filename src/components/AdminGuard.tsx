import React, { useState, useEffect } from 'react'
import { loginAdmin, verifyAdminKey } from '../auth'
import { IS_CLOUD } from '../cloudbase'

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
  if (checking) return <div className="flex items-center justify-center min-h-full text-gray-500" role="status" aria-live="polite">验证中...</div>
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

  return (
    <div className="paper-grain relative flex min-h-full items-center justify-center overflow-hidden bg-surface p-6">
      {/* 品牌场：顶部色带 + 一枚切角柿块压在卡片左上角，
          让"登录"这件事也认得出是江科一站通的后台，而不是任意一个开源模板。 */}
      <span aria-hidden="true" className="brand-bar absolute inset-x-0 top-0 h-1" />
      <div
        aria-hidden="true"
        className="cover-clip absolute -left-12 -top-12 h-40 w-40 opacity-80"
        style={{ background: 'linear-gradient(155deg, #fde047, #eab308 70%, #ca8a04)' }}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-20 -right-16 h-56 w-56 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 35%, rgba(20,83,45,0.16), transparent 62%)' }}
      />

      <div className="relative w-full max-w-sm animate-fade-in-up">
        <div className="mb-6">
          <p className="eyebrow text-gray-500">江科一站通 · 经营侧</p>
          <h2 className="mt-2 text-display-md text-ink">管理后台</h2>
          <p className="mt-1.5 text-sm text-gray-500">请输入管理密钥以继续</p>
        </div>

        <div className="card-base p-6">
          <label htmlFor="admin-key-input" className="eyebrow block text-gray-500">
            管理密钥
          </label>
          <input
            id="admin-key-input"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••"
            aria-label="管理密钥"
            autoFocus
            className="input-base mt-2 mb-3 font-mono tracking-widest"
          />
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

        <p className="mt-5 text-center text-2xs tracking-wide text-gray-500">
          密钥由 Cloudflare Pages 环境变量下发 · 本站不存明文
        </p>
      </div>
    </div>
  )
}
