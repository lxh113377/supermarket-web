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
  if (checking) return <div className="flex items-center justify-center min-h-full text-gray-400">验证中...</div>
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
    <div className="flex items-center justify-center min-h-full bg-gray-50 p-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm">
        <h2 className="text-lg font-bold mb-4 text-center">管理后台</h2>
        <p className="text-sm text-gray-500 mb-4 text-center">
          请输入管理密钥以继续
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="管理密钥"
          aria-label="管理密钥"
          autoFocus
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button
          onClick={handleLogin}
          disabled={checking}
          className="w-full bg-brand-500 text-white py-3 rounded-lg font-medium disabled:opacity-50 hover:bg-brand-600 transition"
        >
          {checking ? '验证中...' : '进入后台'}
        </button>
      </div>
    </div>
  )
}
