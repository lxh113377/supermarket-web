import React, { useState, useEffect, useMemo } from 'react'
import { adminCall } from '../auth.js'
import { CATEGORIES } from '../data/services'

const STATUS_MAP = {
  pending: { label: '待处理', cls: 'bg-yellow-100 text-yellow-700' },
  done: { label: '已处理', cls: 'bg-green-100 text-green-700' },
}

export default function SubmissionsTab() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [preview, setPreview] = useState(null)

  const fetchSubmissions = async () => {
    try {
      const res = await adminCall('getSubmissions', {})
      if (res.code === 0) setSubmissions(res.data || [])
    } catch (e) {
      console.warn('获取服务提交失败:', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSubmissions() }, [])

  // 自动刷新
  useEffect(() => {
    const t = setInterval(fetchSubmissions, 30000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return submissions
    return submissions.filter(s => s.categoryId === filter)
  }, [submissions, filter])

  const handleStatus = async (id, status) => {
    try {
      await adminCall('updateSubmissionStatus', { submissionId: id, status })
      setSubmissions(prev => prev.map(s => s._id === id ? { ...s, status } : s))
    } catch (e) {
      alert('更新失败: ' + e.message)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除该条提交？')) return
    try {
      await adminCall('deleteSubmission', { submissionId: id })
      setSubmissions(prev => prev.filter(s => s._id !== id))
    } catch (e) {
      alert('删除失败: ' + e.message)
    }
  }

  const copySubmission = (s) => {
    const lines = [
      `服务：${s.categoryName} > ${s.serviceName}`,
      ...Object.entries(s.formData || {}).map(([k, v]) => `${k}: ${v}`),
      `图片：${(s.images || []).length}张`,
      `时间：${new Date(s.createdAt).toLocaleString()}`,
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => alert('已复制'))
  }

  const formatField = (key, value) => {
    const labels = { wechat: '微信号', phone: '电话号', building: '楼栋号' }
    return `${labels[key] || key}: ${value}`
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">加载中...</div>
  }

  return (
    <div>
      {/* 筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          全部 ({submissions.length})
        </button>
        {CATEGORIES.map(c => {
          const count = submissions.filter(s => s.categoryId === c.id).length
          return (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === c.id ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {c.name} ({count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无服务提交</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <div key={s._id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{s.serviceName}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_MAP[s.status]?.cls || STATUS_MAP.pending.cls}`}>
                      {STATUS_MAP[s.status]?.label || '待处理'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{s.categoryName} · {new Date(s.createdAt).toLocaleString()}</p>
                  {/* 表单数据 */}
                  <div className="mt-2 space-y-1">
                    {Object.entries(s.formData || {}).map(([k, v]) => (
                      <p key={k} className="text-xs text-gray-600">{formatField(k, v)}</p>
                    ))}
                  </div>
                  {/* 图片 */}
                  {(s.images || []).length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {s.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`截图${i + 1}`}
                          loading="lazy"
                          onClick={() => setPreview(img)}
                          className="w-14 h-14 rounded-lg object-cover border border-gray-200 cursor-pointer hover:opacity-80"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 操作按钮 */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                {s.status === 'pending' && (
                  <button onClick={() => handleStatus(s._id, 'done')} className="px-3 py-1 bg-green-50 text-green-600 rounded-lg text-xs font-medium hover:bg-green-100">
                    标记已处理
                  </button>
                )}
                <button onClick={() => copySubmission(s)} className="px-3 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100">
                  复制
                </button>
                <button onClick={() => handleDelete(s._id)} className="px-3 py-1 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 图片预览弹窗 */}
      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="预览" className="max-w-full max-h-[80vh] rounded-xl" />
        </div>
      )}
    </div>
  )
}
