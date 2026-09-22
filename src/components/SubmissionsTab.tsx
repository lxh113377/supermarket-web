import {  useState, useEffect, useMemo, useCallback  } from 'react'
import { adminCall } from '../auth'
import { CATEGORIES } from '../data/categories'
import EmptyState from './EmptyState'
import { SkeletonTable } from './Skeleton'
import Overlay from './Overlay'
import { IconEmpty } from './Icons'
import type { Submission } from '../types'

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-yellow-100 text-yellow-700' },
  done: { label: '已处理', cls: 'bg-green-100 text-green-700' },
}

export default function SubmissionsTab() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [preview, setPreview] = useState<string | null>(null)
  // 图片按需加载缓存：列表接口只回 imageCount，点开才拉原图，避免手机端一次下载 MB 级 base64
  const [imageCache, setImageCache] = useState<Record<string, string[]>>({})
  const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const loadImages = async (id: string) => {
    if (imageCache[id] || imageLoading[id]) return
    setImageLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await adminCall<{ images: string[] }>('getSubmissionImages', { submissionId: id })
      if (res.code === 0) setImageCache(prev => ({ ...prev, [id]: res.data?.images || [] }))
    } catch (e) {
      console.warn('获取提交图片失败:', e instanceof Error ? e.message : String(e))
    } finally {
      setImageLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  const toggleImages = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
    if (!expanded[id]) loadImages(id)
  }

  // useCallback 固定引用：否则下面 30s 轮询的 effect 依赖不成立（原实现把 [] 当依赖，闭包是首帧的）
  const fetchSubmissions = useCallback(async () => {
    try {
      const res = await adminCall('getSubmissions', {})
      if (res.code === 0) setSubmissions((res.data || []) as Submission[])
    } catch (e) {
      console.warn('获取服务提交失败:', e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])

  // 自动刷新
  useEffect(() => {
    const t = setInterval(fetchSubmissions, 30000)
    return () => clearInterval(t)
  }, [fetchSubmissions])

  const filtered = useMemo(() => {
    if (filter === 'all') return submissions
    return submissions.filter(s => s.categoryId === filter)
  }, [submissions, filter])

  // 各分类计数一次算完：原实现在筛选栏里对每个分类各跑一次 filter（分类数 × 提交数）
  const countsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of submissions) {
      const key = s.categoryId || ''
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [submissions])

  const handleStatus = async (id: string, status: string) => {
    try {
      await adminCall('updateSubmissionStatus', { submissionId: id, status })
      setSubmissions(prev => prev.map(s => s._id === id ? { ...s, status } : s))
    } catch (e) {
      alert('更新失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该条提交？')) return
    try {
      await adminCall('deleteSubmission', { submissionId: id })
      setSubmissions(prev => prev.filter(s => s._id !== id))
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  const copySubmission = (s: Submission) => {
    const lines = [
      `服务：${s.categoryName} > ${s.serviceName}`,
      ...Object.entries(s.formData || {}).map(([k, v]) => `${k}: ${v}`),
      `图片：${s.images?.length ?? s.imageCount ?? 0}张`,
      `时间：${s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}`,
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => alert('已复制'))
  }

  const formatField = (key: string, value: string): string => {
    const labels: Record<string, string> = { wechat: '微信号', phone: '电话号', building: '楼栋号' }
    return `${labels[key] || key}: ${value}`
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <span className="sr-only" role="status">加载服务提交中</span>
        <SkeletonTable rows={3} />
      </div>
    )
  }

  return (
    <div>
      {/* 筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap" role="group" aria-label="按服务分类筛选">
        <button
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          全部 ({submissions.length})
        </button>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === c.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {c.name} ({countsByCategory[c.id] || 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconEmpty className="w-6 h-6" />}
          title="暂无服务提交"
          description={filter === 'all' ? '顾客提交生活服务需求后会出现在这里' : '该分类下暂时没有提交记录'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <div key={s._id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{s.serviceName}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_MAP[s.status || 'pending']?.cls || STATUS_MAP.pending.cls}`}>
                      {STATUS_MAP[s.status || 'pending']?.label || '待处理'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{s.categoryName} · {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</p>
                  {/* 表单数据 */}
                  <div className="mt-2 space-y-1">
                    {Object.entries(s.formData || {}).map(([k, v]) => (
                      <p key={k} className="text-xs text-gray-600">{formatField(k, v)}</p>
                    ))}
                  </div>
                  {/* 图片：按需加载（列表不再内联 base64，避免手机端首屏下载 MB 级数据） */}
                  {(s.images?.length ?? s.imageCount ?? 0) > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleImages(s._id)}
                        className="px-2.5 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100"
                      >
                        {expanded[s._id] ? '收起图片' : `查看图片 (${s.images?.length ?? s.imageCount ?? 0})`}
                      </button>
                      {expanded[s._id] && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {imageLoading[s._id] && (
                            <span className="text-xs text-gray-400 py-4" role="status">图片加载中...</span>
                          )}
                          {/* 图片本身可点开预览 —— 用 button 包裹而不是给 img 挂 onClick，
                              键盘用户与读屏用户才能操作（原实现只有鼠标能点） */}
                          {(s.images || imageCache[s._id] || []).map((img, i) => (
                            <button
                              key={i}
                              onClick={() => setPreview(img)}
                              aria-label={`查看截图 ${i + 1}`}
                              className="w-14 h-14 rounded-lg overflow-hidden border border-gray-200 hover:opacity-80 transition focus-visible:outline-2 focus-visible:outline-brand-500"
                            >
                              <img
                                src={img}
                                alt=""
                                width={56}
                                height={56}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* 操作按钮：py-2 把命中高度撑到 ~36px + .tap-44 外扩至 44px */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                {s.status === 'pending' && (
                  <button onClick={() => handleStatus(s._id, 'done')} className="tap-44 px-3 py-2 bg-green-50 text-green-600 rounded-lg text-xs font-medium hover:bg-green-100">
                    标记已处理
                  </button>
                )}
                <button onClick={() => copySubmission(s)} className="tap-44 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100">
                  复制
                </button>
                <button onClick={() => handleDelete(s._id)} className="tap-44 px-3 py-2 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 图片预览：改用统一 Overlay（补齐原实现缺失的焦点陷阱与焦点归还） */}
      <Overlay
        open={!!preview}
        onClose={() => setPreview(null)}
        label="图片预览"
        className="max-w-2xl p-2 bg-transparent border-0 shadow-none"
      >
        {preview && (
          <img
            src={preview}
            alt="提交截图预览"
            className="max-w-full max-h-[75vh] mx-auto rounded-xl"
          />
        )}
        <button
          onClick={() => setPreview(null)}
          data-autofocus
          className="mt-3 mx-auto block px-5 py-2.5 bg-white/90 text-gray-700 rounded-xl text-sm font-medium"
        >
          关闭
        </button>
      </Overlay>
    </div>
  )
}
