import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getServiceById, getCategoryById } from '../data/services'
import { isBusinessHours, getClosedMessage } from '../utils/businessHours'
import { createSubmission } from '../db'
import ServiceHintCard from '../components/service/ServiceHintCard'
import ServicePopup from '../components/service/ServicePopup'
import type { ServiceCategory } from '../types'

// 压缩图片到合理大小
function compressImage(file: File, maxWidth = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== 'string') {
        reject(new Error('图片读取失败'))
        return
      }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > maxWidth) {
          height = Math.round(height * maxWidth / width)
          width = maxWidth
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas 不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ServiceFormPage() {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const service = serviceId ? getServiceById(serviceId) : undefined
  const category: ServiceCategory | undefined = service ? getCategoryById(service.categoryId) : undefined
  const open = isBusinessHours()

  const [showPopup, setShowPopup] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [images, setImages] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (service?.popup) {
      setShowPopup(true)
    }
  }, [service])

  if (!service) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center animate-fade-in-up">
          <span className="text-4xl block mb-3">🔍</span>
          <p className="text-gray-400 text-sm">服务不存在</p>
          <button onClick={() => navigate('/')} className="mt-4 text-brand-500 text-sm font-medium">
            返回首页
          </button>
        </div>
      </div>
    )
  }

  // 服务说明已拆至 ServiceHintCard（hint 分段解析随迁），此处不再需要 hintSections

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
    setError('')
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const valid = files.filter(f => {
      if (!f.type.startsWith('image/')) { setError('仅支持图片文件'); return false }
      if (f.size > 10 * 1024 * 1024) { setError('单张图片不能超过10MB'); return false }
      return true
    })
    if (images.length + valid.length > 5) {
      setError('最多上传5张图片')
      e.target.value = ''
      return
    }
    if (valid.length === 0) { e.target.value = ''; return }
    try {
      const compressed = await Promise.all(valid.map(f => compressImage(f)))
      setImages(prev => [...prev, ...compressed])
      setError('')
    } catch {
      setError('图片处理失败，请重试')
    }
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const validate = (): boolean => {
    for (const field of (service.fields || [])) {
      if (field.required) {
        if (field.type === 'image') {
          if (images.length < (field.minCount || 1)) {
            setError(`请上传${field.label}`)
            return false
          }
        } else if (!formData[field.key]?.trim()) {
          setError(`请填写${field.label}`)
          return false
        }
      }
    }
    const phoneField = (service.fields || []).find(f => f.type === 'tel')
    if (phoneField && formData[phoneField.key]) {
      if (!/^1\d{10}$/.test(formData[phoneField.key].trim())) {
        setError('请输入正确的11位手机号')
        return false
      }
    }
    return true
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setError('')
    try {
      const submission = {
        serviceId: service.id,
        serviceName: service.name,
        categoryId: service.categoryId,
        categoryName: category?.name || '',
        formData: { ...formData },
        images: images.length > 0 ? images : undefined,
        createdAt: new Date().toISOString(),
      }
      await createSubmission(submission)
      setSubmitted(true)
    } catch (e) {
      setError('提交失败: ' + (e instanceof Error ? e.message : '网络错误，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  // 提交成功页面
  if (submitted) {
    return (
      <div className="page-container flex items-center justify-center px-5">
        <div className="bg-white rounded-3xl p-8 shadow-card border border-gray-100/80 text-center max-w-sm w-full animate-scale-in">
          <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
            <span className="text-4xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900">提交成功</h2>
          <p className="text-gray-400 text-sm mt-2 leading-relaxed">请耐心等待工作人员联系<br/>通常会在30分钟内回复</p>
          <button
            onClick={() => navigate('/')}
            className="mt-7 btn-primary w-full py-3.5 text-base"
          >
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${category?.color || 'from-gray-400 to-gray-500'} text-white px-5 pt-10 pb-14`}>
        {/* 装饰元素 */}
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute top-12 -left-6 w-20 h-20 rounded-full bg-white/5" />
        <div className="absolute bottom-2 right-16 w-12 h-12 rounded-full bg-white/8" />

        <div className="relative z-10 max-w-lg mx-auto">
          {/* 返回按钮 */}
          <button
            onClick={() => navigate(`/category/${service.categoryId}`)}
            aria-label="返回"
            className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-white/25 transition-all duration-200 active:scale-90 mb-5"
          >
            ←
          </button>

          {/* 服务图标+名称 */}
          <div className="flex items-center gap-4 animate-fade-in-up">
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-3xl shadow-soft">
              {service.icon}
            </div>
            <div>
              <h1 className="text-xl font-bold">{service.name}</h1>
              <p className="text-white/70 text-xs mt-1">{service.description}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 非营业时间提示 */}
      {!open && (
        <div className="mx-5 -mt-6 relative z-10 max-w-lg md:mx-auto animate-fade-in-up stagger-1">
          <div className="bg-amber-50/95 backdrop-blur-sm border border-amber-200/80 rounded-2xl p-4 shadow-card">
            <p className="text-amber-700 text-xs flex items-center gap-2.5">
              <span className="text-base">⚠️</span>
              <span className="leading-relaxed">{getClosedMessage()}</span>
            </p>
          </div>
        </div>
      )}

      {/* 主内容区：桌面端放宽到 max-w-2xl（原先恒 max-w-lg，大屏两侧大片留白） */}
      <div className={`px-5 max-w-lg md:max-w-2xl mx-auto pb-12 ${open ? '-mt-6' : 'mt-5'}`}>

        {/* 服务说明卡片（hint 解析与渲染已在 ServiceHintCard） */}
        <ServiceHintCard hint={service.hint} />

        {/* 表单卡片 */}
        <div className="bg-white rounded-3xl p-6 shadow-card border border-gray-100/80 animate-fade-in-up stagger-2">
          <div className="flex items-center gap-2 mb-5">
            <span className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center text-xs">📝</span>
            <h3 className="text-sm font-semibold text-gray-800">填写信息</h3>
          </div>

          <div className="space-y-5">
            {(service.fields || []).map(field => (
              <div key={field.key}>
                {/* label 与控件显式关联：原实现 label 用包裹式但控件是兄弟节点，
                    读屏只念「编辑框」不念字段名 */}
                <label
                  htmlFor={`sf-${field.key}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2.5"
                >
                  {field.label}
                  {field.required && <span className="text-red-400 text-xs" aria-hidden="true">*</span>}
                </label>

                {field.type === 'image' ? (
                  <div>
                    {field.hint && (
                      <p className="text-xs text-gray-400 mb-3 leading-relaxed" id={`sf-hint-${field.key}`}>{field.hint}</p>
                    )}
                    {images.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mb-3">
                        {images.map((img, i) => (
                          <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 shadow-soft animate-scale-in group">
                            <img
                              src={img}
                              alt={`已上传截图 ${i + 1}`}
                              width={160}
                              height={160}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                            <button
                              onClick={() => removeImage(i)}
                              aria-label={`删除截图 ${i + 1}`}
                              // P0-14：触屏/键盘可用（原 opacity-0 仅 hover 可见，移动端无法删除）
                              style={{ '--tap-x': '10px', '--tap-y': '10px' } as CSSProperties}
                              className="tap-44 absolute top-1 right-1 w-6 h-6 bg-black/50 backdrop-blur-sm text-white rounded-full text-xs flex items-center justify-center opacity-70 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 text-center text-gray-400 text-sm hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/30 transition-all duration-300 active:scale-[0.98]"
                    >
                      <span className="block text-2xl mb-2" aria-hidden="true">📷</span>
                      <span className="font-medium">点击上传截图</span>
                      <span className="block text-xs text-gray-300 mt-1">至少{field.minCount || 1}张，最多5张</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      id={`sf-${field.key}`}
                      type="file"
                      accept="image/*"
                      multiple
                      aria-label={`上传${field.label}`}
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <input
                    id={`sf-${field.key}`}
                    type={field.type === 'tel' ? 'tel' : 'text'}
                    value={formData[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    maxLength={field.type === 'tel' ? 11 : 50}
                    required={field.required}
                    aria-required={field.required || undefined}
                    aria-describedby={field.hint ? `sf-hint-${field.key}` : undefined}
                    className="input-base"
                  />
                )}
              </div>
            ))}
          </div>

          {/* 错误提示：role="alert" 让读屏在提交校验失败时立即播报 */}
          <div role="alert" aria-live="assertive">
            {error && (
              <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3 animate-slide-down">
                <p className="text-red-500 text-xs flex items-center gap-2">
                  <span aria-hidden="true">⚡</span> {error}
                </p>
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary w-full py-4 text-base mt-6 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <span>提交信息</span>
                <span className="text-white/70">→</span>
              </>
            )}
          </button>
        </div>

        {/* 底部提示 */}
        <p className="text-center text-xs text-gray-300 mt-6 flex items-center justify-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-gray-200" />
          提交后请耐心等待工作人员联系
          <span className="w-1 h-1 rounded-full bg-gray-200" />
        </p>
      </div>

      {/* 弹窗提示（ServicePopup：dialog 语义 + Esc 关闭，P0-12 保留） */}
      {showPopup && service.popup && (
        <ServicePopup popup={service.popup} onClose={() => setShowPopup(false)} />
      )}
    </div>
  )
}
