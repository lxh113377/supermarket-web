// 打印下单表单：文件上传（≤9，含 pdf/docx/pptx）+ 楼栋号/房间号必填 + 微信号/备注选填。
//
// 所有准入与校验都走 printFormLogic（纯函数、有单测），本组件只负责把结果翻译成界面状态 ——
// 规则写在组件里就无法单测，而"选满九张才发现格式不对"正是最容易挨骂的那类事故。

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSubmission } from '../../db'
import { uploadPrintFile } from '../../utils/printUpload'
import { FILE_KIND_LABEL, MAX_INLINE_UPLOAD_BYTES, MAX_PRINT_FILES, PRINT_ACCEPT } from './print.config'
import { fileExtOf, formatBytes, overflowReason, screenFiles, validatePrintForm, type PrintFormValues } from './printFormLogic'

interface Picked {
  id: string
  file: File
  status: 'uploading' | 'done' | 'error'
  ref?: string
  inline?: boolean
  error?: string
  preview?: string
}

interface Props {
  /** 点「返回首页」：交给页面层做遮罩式出场过渡，不在组件里直接 navigate。 */
  onHome: () => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export default function PrintForm({ onHome }: Props) {
  const [files, setFiles] = useState<Picked[]>([])
  const [values, setValues] = useState<PrintFormValues>({ building: '', room: '', wechat: '', remark: '' })
  const [notice, setNotice] = useState<string[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 组件卸载时回收 objectURL：不回收的话每次重选都会泄漏一串 blob
  const previews = useRef<string[]>([])

  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  const addFiles = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const incoming = Array.from(list)
    const overflow = overflowReason(files.length, incoming.length)
    if (overflow) { setError(overflow); return }

    const { accepted, rejected } = screenFiles(incoming)
    const notes = rejected.map((r) => `${r.name}：${r.reason}`)
    const room = MAX_PRINT_FILES - files.length
    if (accepted.length > room) {
      notes.push(`最多 ${MAX_PRINT_FILES} 个文件，本次只收下前 ${room} 个`)
    }
    const take = accepted.slice(0, Math.max(0, room))
    setNotice(notes)
    if (take.length === 0) { setError(notes[0] || '没有可用的文件'); return }
    setError('')

    const picked: Picked[] = take.map((file) => {
      const ext = fileExtOf(file.name)
      let preview: string | undefined
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) {
        preview = URL.createObjectURL(file)
        previews.current.push(preview)
      }
      return { id: uid(), file, status: 'uploading' as const, preview }
    })
    setFiles((prev) => [...prev, ...picked])

    // 并发 3：再多会把手机上传带宽打满，剩下的排队反而更久
    const queue = [...picked]
    const worker = async () => {
      for (;;) {
        const item = queue.shift()
        if (!item) return
        try {
          const r = await uploadPrintFile(item.file)
          setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'done', ref: r.ref, inline: r.inline } : f)))
        } catch (e) {
          const msg = e instanceof Error ? e.message : '上传失败'
          setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'error', error: msg } : f)))
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }, [files.length])

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setError('')
  }

  const setValue = (k: keyof PrintFormValues, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }))
    setError('')
  }

  const busy = files.some((f) => f.status === 'uploading')
  const badFiles = files.filter((f) => f.status === 'error')

  const handleSubmit = async () => {
    const v = validatePrintForm(values, files.map((f) => ({ name: f.file.name, size: f.file.size })))
    if (!v.ok) { setError(v.reason); return }
    if (busy) { setError('文件还在上传，请稍候'); return }
    const refs = files.map((f) => f.ref).filter((x): x is string => !!x)
    if (refs.length !== files.length) { setError(`有 ${files.length - refs.length} 个文件上传失败，请删除后重试`); return }

    setSubmitting(true)
    setError('')
    try {
      await createSubmission({
        serviceId: 'print',
        serviceName: '打印',
        categoryId: 'study',
        categoryName: '学习',
        formData: {
          building: values.building.trim(),
          room: values.room.trim(),
          wechat: values.wechat?.trim() || '',
          remark: values.remark?.trim() || '',
          fileList: files.map((f) => f.file.name).join('、').slice(0, 200),
        },
        images: refs,
        createdAt: new Date().toISOString(),
      })
      setSubmitted(true)
    } catch (e) {
      setError('提交失败：' + (e instanceof Error ? e.message : '网络错误，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section data-print-section className="print-section relative flex items-center justify-center px-6">
        <div className="print-glass print-neon-edge rounded-4xl p-8 w-full max-w-sm text-center animate-scale-in">
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-to-br from-cyan-400/25 to-fuchsia-500/25 flex items-center justify-center">
            <span className="print-check text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">已送到打印店</h2>
          <p className="text-slate-400 text-[13px] mt-3 leading-relaxed">
            {values.building.trim()} · {values.room.trim()}
            <br />
            共 {files.length} 个文件，印好会送到宿舍门口
          </p>
          {values.wechat?.trim() ? (
            <p className="text-slate-500 text-[12px] mt-2">微信号 {values.wechat.trim()}</p>
          ) : null}
          <button
            onClick={onHome}
            className="mt-7 w-full py-3.5 rounded-2xl font-medium text-[#05070d] bg-gradient-to-r from-cyan-300 to-fuchsia-400 active:scale-[0.98] transition-transform"
          >
            返回首页
          </button>
        </div>
      </section>
    )
  }

  return (
    <section data-print-section className="print-section relative px-5 pt-24 pb-40">
      <div className="max-w-md mx-auto">
        <p className="print-title text-2xl font-bold">下单</p>
        <p className="text-[12px] text-slate-400 mt-2">上传文件 → 填楼栋房间 → 等送达</p>

        {/* 上传区 */}
        <div className="print-glass print-neon-edge rounded-3xl p-5 mt-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-slate-200">文件</span>
            <span className="text-[11px] text-slate-500 tabular-nums">{files.length} / {MAX_PRINT_FILES}</span>
          </div>

          <button
            onClick={() => inputRef.current?.click()}
            disabled={files.length >= MAX_PRINT_FILES}
            className="w-full rounded-2xl border border-dashed border-cyan-300/30 py-7 text-center hover:border-cyan-300/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="block text-2xl mb-2" aria-hidden="true">📄</span>
            <span className="block text-[13px] text-slate-300">点击上传文档或照片</span>
            <span className="block text-[11px] text-slate-500 mt-1">支持 PDF / Word / PPT / Excel / 图片，单个 ≤20MB</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={PRINT_ACCEPT}
            onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }}
            className="hidden"
            aria-label="上传打印文件"
          />

          {files.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-2.5">
              {files.map((f) => {
                const ext = fileExtOf(f.file.name)
                return (
                  <li key={f.id} className="relative aspect-square rounded-xl overflow-hidden bg-[#0b1020]/80 border border-white/5">
                    {f.preview ? (
                      <img src={f.preview} alt={f.file.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <span className="text-lg">{ext === 'pdf' ? '📕' : '📘'}</span>
                        <span className="text-[10px] text-slate-400">{FILE_KIND_LABEL[ext] || ext.toUpperCase()}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeFile(f.id)}
                      aria-label={`删除 ${f.file.name}`}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                    >
                      ×
                    </button>
                    <span className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/85 to-transparent text-[9px] text-slate-300 truncate">
                      {f.status === 'uploading' ? '上传中…' : f.status === 'error' ? '失败' : formatBytes(f.file.size)}
                    </span>
                    {f.status === 'uploading' && (
                      <span className="absolute inset-0 bg-[#05070d]/55 flex items-center justify-center">
                        <span className="w-4 h-4 border-2 border-cyan-300/40 border-t-cyan-300 rounded-full animate-spin" />
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {badFiles.length > 0 && (
            <p className="mt-3 text-[11px] text-rose-300 leading-relaxed">
              {badFiles.map((f) => `${f.file.name}：${f.error}`).join('；')}
            </p>
          )}
          {files.some((f) => f.inline) && (
            <p className="mt-3 text-[11px] text-amber-300/80 leading-relaxed">
              云存储未就绪，当前按小文件直交（单个 ≤{Math.round(MAX_INLINE_UPLOAD_BYTES / 1024)}KB）。更大的文件请加微信补发。
            </p>
          )}
        </div>

        {/* 地址 */}
        <div className="print-glass print-neon-edge rounded-3xl p-5 mt-4">
          <span className="text-[13px] font-medium text-slate-200">送到哪儿</span>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-400">楼栋号 <span className="text-rose-400">*</span></span>
              <input
                value={values.building}
                onChange={(e) => setValue('building', e.target.value)}
                placeholder="例如：36栋"
                maxLength={50}
                className="mt-1.5 w-full rounded-xl bg-[#05070d]/60 border border-white/10 px-3 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-300/60 transition-colors"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">房间号 <span className="text-rose-400">*</span></span>
              <input
                value={values.room}
                onChange={(e) => setValue('room', e.target.value)}
                placeholder="例如：502"
                maxLength={50}
                className="mt-1.5 w-full rounded-xl bg-[#05070d]/60 border border-white/10 px-3 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-300/60 transition-colors"
              />
            </label>
          </div>
          <label className="block mt-3">
            <span className="text-[11px] text-slate-400">微信号（选填）</span>
            <input
              value={values.wechat || ''}
              onChange={(e) => setValue('wechat', e.target.value)}
              placeholder="有问题可以微信找你"
              maxLength={50}
              className="mt-1.5 w-full rounded-xl bg-[#05070d]/60 border border-white/10 px-3 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-300/60 transition-colors"
            />
          </label>
          <label className="block mt-3">
            <span className="text-[11px] text-slate-400">备注（选填）</span>
            <textarea
              value={values.remark || ''}
              onChange={(e) => setValue('remark', e.target.value)}
              placeholder="黑白/彩印、单双面、份数…"
              maxLength={200}
              rows={3}
              className="mt-1.5 w-full rounded-xl bg-[#05070d]/60 border border-white/10 px-3 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-300/60 transition-colors resize-none"
            />
          </label>
        </div>

        {notice.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3">
            {notice.map((n, i) => <p key={i} className="text-[11px] text-amber-200/90 leading-relaxed">{n}</p>)}
          </div>
        )}
        <div role="alert" aria-live="assertive">
          {error && (
            <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3">
              <p className="text-[12px] text-rose-200">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* 底部固定提交条 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 bg-gradient-to-t from-[#05070d] via-[#05070d]/90 to-transparent">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleSubmit}
            disabled={submitting || busy}
            className="w-full py-4 rounded-2xl font-medium text-[#05070d] bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-400 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform shadow-[0_10px_40px_-12px_rgba(110,231,255,0.7)]"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-[#05070d]/30 border-t-[#05070d] rounded-full animate-spin" />
                提交中…
              </span>
            ) : busy ? '文件上传中…' : `提交打印 · ${files.length} 个文件`}
          </button>
        </div>
      </div>
    </section>
  )
}
