import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getServiceById, getCategoryById } from '../data/services'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { createSubmission } from '../db'
import ServiceHintCard from '../components/service/ServiceHintCard'
import ServicePopup from '../components/service/ServicePopup'
import type { ServiceCategory } from '../types'
import { compressImageFile } from '../utils/imageCompress'
import { MAX_SUBMISSION_FILES } from '../data/submissionLimits'
import { uploadPrintFile } from '../utils/printUpload'
import { PRINT_INLINE_ACCEPT, PRINT_INLINE_ALLOWED_EXT, MAX_PRINT_FILES } from '../pages/print/print.config'

export default function ServiceFormPage() {
  const { serviceId } = useParams()
  const navigate = useNavigate()
  const service = serviceId ? getServiceById(serviceId) : undefined
  const category: ServiceCategory | undefined = service ? getCategoryById(service.categoryId) : undefined
  const open = useBusinessHours()

  const [showPopup, setShowPopup] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [images, setImages] = useState<string[]>([])
  // 'file' 字段专用元数据，与 images **同下标**（上传后拿到的名字与是否走了内联降级）。
  // 为什么单独一份：`images` 里存的是 `r2:<key>` 或 data: URL，读不出文件名；后台要看的
  // 是「顾客传了哪个文件」，光看缩略图/字节串没有意义。
  const [fileMeta, setFileMeta] = useState<{ name: string; inline: boolean }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  // 提示与错误**分轨**（2026-10-23）：内联降级那句是「文件收下了，但大文件请改个小一点的」，
  // 走 setError 会渲染进 `role="alert" aria-live="assertive"` 的红色错误框里 ⇒ 顾客读成
  // 「上传失败」而放弃下单，实际单已经能提交。红色只留给真失败。
  const [notice, setNotice] = useState('')
  // 出错字段的 key（2026-10-23）：错误文本单独放在表单下方时，读屏用户听到
  // 「请填写楼栋号」却不知道焦点在哪个框上。aria-invalid + aria-describedby 指向
  // 错误容器才能把「这条错误属于这个字段」说清楚。刻意用 key 而不是拿 error 文本
  // 反查字段名（OrderConfirmPage 那种 error.includes('楼栋') 的写法依赖 label 文案
  // 不变，label 一改就静默失效）—— 这里字段是数据驱动的，key 是唯一稳定身份。
  const [errorField, setErrorField] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 文档上传用**另一个 ref**：只留一个 fileInputRef 时，同一张表单里 'image' 字段与
  // 'file' 字段会抢它 —— 「点击上传」于是会打开错的那个选择器。现在只有打印用到
  // 'file'，但这是加一个字段就会踩的雷，提前分轨。（顺带：这里不能写出那个标签字面量，
  // a11y 静态判据扫的是 tsx 原文且不剥注释，写了会被当成一个没有名字的控件而判红。）
  const docInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (service?.popup) {
      setShowPopup(true)
    }
    // 换服务时清空附件两态：images 与 fileMeta 是**同下标**的一对，只清一个就会让
    // 后台看到「A 服务的文件配着 B 服务的文件名」。切路由时表单本就该从零开始。
    setImages([])
    setFileMeta([])
  }, [service])

  if (!service) {
    return (
      <div role="main" id="main-content" tabIndex={-1} className="page-container flex items-center justify-center">
        <div className="text-center animate-fade-in-up">
          <span className="text-4xl block mb-3">🔍</span>
          <p className="text-stone-500 text-sm">服务不存在</p>
          <button onClick={() => navigate('/')} className="mt-4 text-brand-700 text-sm font-medium">
            返回首页
          </button>
        </div>
      </div>
    )
  }

  // 服务说明已拆至 ServiceHintCard（hint 分段解析随迁），此处不再需要 hintSections

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
    // 只清「正在改的这个字段」的错误：用户改楼栋号时不该把手机号的错误提示也抹掉，
    // 也不该留着本字段的 aria-invalid（否则修正后读屏仍报「无效」）。
    setError(errorField === key ? '' : error)
    if (errorField === key) setErrorField('')
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const valid = files.filter(f => {
      if (!f.type.startsWith('image/')) { setError('仅支持图片文件'); return false }
      if (f.size > 10 * 1024 * 1024) { setError('单张图片不能超过10MB'); return false }
      return true
    })
    if (images.length + valid.length > MAX_SUBMISSION_FILES) {
      setError(`最多上传${MAX_SUBMISSION_FILES}张图片`)
      e.target.value = ''
      return
    }
    if (valid.length === 0) { e.target.value = ''; return }
    try {
      const compressed = await Promise.all(
        valid.map(async (f) => (await compressImageFile(f, { maxSize: 800, quality: 0.7 })).dataUrl),
      )
      setImages(prev => [...prev, ...compressed])
      setError('')
      setErrorField('')
    } catch {
      setError('图片处理失败，请重试')
    }
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  /** 文档上传：一条路 = /upload 直传，端点不可用则 ≤512KB 内联（见 utils/printUpload）。 */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    if (images.length + picked.length > MAX_PRINT_FILES) {
      setError(`最多上传${MAX_PRINT_FILES}个文件`)
      e.target.value = ''
      return
    }
    // 准入只看扩展名，且必须是**内联那条窄名单**：宽名单里的 ppt/xls/heic/txt 服务端
    // 在内联形态下会判「文件格式无效」，让顾客按提示选了再被拒是本文件反复防的那类错。
    const bad = picked.find((f) => {
      const ext = String(f.name).split('.').pop()?.toLowerCase() || ''
      return !(PRINT_INLINE_ALLOWED_EXT as readonly string[]).includes(ext)
    })
    if (bad) {
      setError(`「${bad.name}」的类型暂不支持，请改成 PDF / Word / PPTX / XLSX 或图片`)
      setErrorField('files')
      e.target.value = ''
      return
    }
    setError('')
    setErrorField('')
    setNotice('')
    setSubmitting(true)
    try {
      const uploaded: Awaited<ReturnType<typeof uploadPrintFile>>[] = []
      for (const f of picked) uploaded.push(await uploadPrintFile(f))
      setImages((prev) => [...prev, ...uploaded.map((u) => u.ref)])
      setFileMeta((prev) => [...prev, ...uploaded.map((u) => ({ name: u.name, inline: u.inline }))])
      if (uploaded.some((u) => u.inline)) {
        // 措辞刻意**不含**「以内联方式提交」这几个字：每个文件自己的 chip 上已经钉了
        // 那句（`以内联方式提交（未走云存储）`，tests/serviceFormPage.test.tsx 用它断言
        // 「顾客必须知道文件没进云存储」）。这里再重复一遍会让那句在页面上出现两次，
        // 按文本查的测试会因「找到多个元素」而红 —— 提示轨说的是**下一步该怎么做**，
        // chip 说的是**这个文件现在什么状态**，各司其职。
        setNotice('文件已收到（未走云存储）；超过 512KB 的建议先压缩，或改用微信发送')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件上传失败，请重试')
      setErrorField('files')
    } finally {
      setSubmitting(false)
      e.target.value = ''
    }
  }

  const removeFile = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
    setFileMeta((prev) => prev.filter((_, i) => i !== index))
    setNotice('')
  }

  const validate = (): boolean => {
    for (const field of (service.fields || [])) {
      if (field.required) {
        // 'image' 与 'file' 共用 images 这一个数组（提交体里都落在 images 字段），
        // 差别只在准入与压缩：前者只收 image/*、后者按窄名单原样上传。
        if (field.type === 'image' || field.type === 'file') {
          if (images.length < (field.minCount || 1)) {
            setError(`请上传${field.label}`)
            setErrorField(field.key)
            return false
          }
        } else if (!formData[field.key]?.trim()) {
          setError(`请填写${field.label}`)
            setErrorField(field.key)
          return false
        }
      }
    }
    const phoneField = (service.fields || []).find(f => f.type === 'tel')
    if (phoneField && formData[phoneField.key]) {
      if (!/^1\d{10}$/.test(formData[phoneField.key].trim())) {
        setError('请输入正确的11位手机号')
        setErrorField(phoneField.key)
        return false
      }
    }
    setErrorField('')
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
          <h1 className="text-xl font-bold text-ink">提交成功</h1>
          <p className="text-stone-500 text-sm mt-2 leading-relaxed">请耐心等待工作人员联系<br/>通常会在30分钟内回复</p>
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
    <div role="main" id="main-content" tabIndex={-1} className="page-container">
      {/* Header */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${category?.color || 'from-gray-600 to-gray-700'} text-white px-5 pt-10 pb-14`}>
        {/* 装饰元素 */}
        {/* 装饰圆 → 品牌色带（与首页/分类页同一套形状语言） */}
        <span aria-hidden="true" className="brand-bar absolute inset-x-0 top-0 h-1" />

        <div className="relative z-10 max-w-lg mx-auto">
          {/* 返回按钮 */}
          <button
            onClick={() => navigate(`/category/${service.categoryId}`)}
            aria-label="返回"
            className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-white/25 transition duration-200 active:scale-90 mb-5"
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
            <p className="text-amber-800 text-xs flex items-center gap-2.5">
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
            <h2 className="text-sm font-semibold text-ink-soft">填写信息</h2>
          </div>

          <div className="space-y-5">
            {(service.fields || []).map(field => (
              <div key={field.key}>
                {/* label 与控件显式关联：原实现 label 用包裹式但控件是兄弟节点，
                    读屏只念「编辑框」不念字段名 */}
                <label
                  htmlFor={`sf-${field.key}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-stone-700 mb-2.5"
                >
                  {field.label}
                  {field.required && <span className="text-red-700 text-xs" aria-hidden="true">*</span>}
                </label>

                {field.type === 'image' ? (
                  <div>
                    {field.hint && (
                      <p className="text-xs text-stone-500 mb-3 leading-relaxed" id={`sf-hint-${field.key}`}>{field.hint}</p>
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
                      /* 关联落在**可见的按钮**上：真正的 file input 是 className="hidden"，
                         读屏不会念隐藏元素，给它加 aria-invalid 等于没加。 */
                      aria-invalid={errorField === field.key || undefined}
                      aria-describedby={[field.hint ? `sf-hint-${field.key}` : '', errorField === field.key ? 'sf-error' : ''].filter(Boolean).join(' ') || undefined}
                      className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 text-center text-stone-500 text-sm hover:border-brand-500 hover:text-brand-700 hover:bg-brand-50/30 transition duration-300 active:scale-[0.98]"
                    >
                      <span className="block text-2xl mb-2" aria-hidden="true">📷</span>
                      <span className="font-medium">点击上传截图</span>
                      <span className="block text-xs text-stone-500 mt-1">至少{field.minCount || 1}张，最多{MAX_SUBMISSION_FILES}张</span>
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
                ) : field.type === 'file' ? (
                  <div>
                    {field.hint && (
                      <p className="text-xs text-stone-500 mb-3 leading-relaxed" id={`sf-hint-${field.key}`}>{field.hint}</p>
                    )}
                    {images.length > 0 && (
                      <ul className="mb-3 space-y-2">
                        {images.map((_, i) => (
                          <li key={i} className="flex items-center gap-2.5 rounded-xl border border-gray-200 px-3 py-2.5 bg-white">
                            <span className="text-base shrink-0" aria-hidden="true">📄</span>
                            {/* 名字来自上传结果，不是 img：img 里存的是 r2:<key> 或 data: URL，读不出文件名 */}
                            <span className="min-w-0 flex-1 text-xs text-ink-soft truncate">
                              {fileMeta[i]?.name || `文件 ${i + 1}`}
                              {fileMeta[i]?.inline && (
                                <span className="block text-stone-500 mt-0.5">以内联方式提交（未走云存储）</span>
                              )}
                            </span>
                            <button
                              onClick={() => removeFile(i)}
                              aria-label={`删除文件 ${fileMeta[i]?.name || i + 1}`}
                              style={{ '--tap-x': '10px', '--tap-y': '10px' } as CSSProperties}
                              className="tap-44 shrink-0 w-7 h-7 rounded-lg bg-gray-100 text-stone-600 flex items-center justify-center"
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      onClick={() => docInputRef.current?.click()}
                      /* 与图片分支同规：关联落在**可见按钮**上（隐藏的 input 读屏不念） */
                      aria-invalid={errorField === field.key || undefined}
                      aria-describedby={[field.hint ? `sf-hint-${field.key}` : '', errorField === field.key ? 'sf-error' : ''].filter(Boolean).join(' ') || undefined}
                      className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 text-center text-stone-500"
                    >
                      <span className="block text-2xl mb-2" aria-hidden="true">🖨️</span>
                      <span className="font-medium">点击选择要打印的文件</span>
                      <span className="block text-xs text-stone-500 mt-1">至少1个，最多{MAX_PRINT_FILES}个</span>
                    </button>
                    <input
                      ref={docInputRef}
                      id={`sf-${field.key}`}
                      type="file"
                      accept={PRINT_INLINE_ACCEPT}
                      multiple
                      aria-label={`上传${field.label}`}
                      onChange={handleFileSelect}
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
                    aria-invalid={errorField === field.key || undefined}
                    /* 只引 sf-error：hint 那个 <p> **只在图片分支**渲染（见上面
                       field.type === 'image' 一段），文本框这边就算数据里有 hint 也不会
                       画出该元素 ⇒ 引它就是悬空 id（读屏会念一段空描述）。文本字段的
                       辅助说明走 placeholder，不占 describedby。 */
                    aria-describedby={errorField === field.key ? 'sf-error' : undefined}
                    className="input-base"
                  />
                )}
              </div>
            ))}
          </div>

          {/* 错误提示：role="alert" 让读屏在提交校验失败时立即播报；id 供出错字段的
              aria-describedby 反向指过来（读屏在字段上能听到「这条错误属于我」）。 */}
          <div id="sf-error" role="alert" aria-live="assertive">
            {error && (
              <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3 animate-slide-down">
                <p className="text-red-700 text-xs flex items-center gap-2">
                  <span aria-hidden="true">⚡</span> {error}
                </p>
              </div>
            )}
          </div>

          {/* 提示（非错误）：`aria-live="polite"` 不打断读屏，绿色也不暗示失败。
              内联降级就属于这一类 —— 文件确实收到了，只是大文件建议改小。 */}
          {notice && (
            <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3" role="status" aria-live="polite">
              <p className="text-emerald-800 text-xs flex items-start gap-2">
                <span aria-hidden="true">✅</span>
                <span className="leading-relaxed">{notice}</span>
              </p>
            </div>
          )}

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
        <p className="text-center text-xs text-stone-500 mt-6 flex items-center justify-center gap-1.5">
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
