// 打印表单的纯逻辑（**不碰 DOM、不发请求**）——单测主战场。
//
// 为什么单独拆出来：PrintForm.tsx 里有大量动效与 3D 相关的 JSX，塞进组件就等于不可测；
// 而"哪些文件能进、哪些字段必填"恰恰是最容易出线上事故的部分（一个扩展名判错，
// 顾客选完九张才被服务端整条退回）。纯函数化之后 tests/printFormLogic.test.ts 能直接钉住边界。

import { MAX_PRINT_FILES, PRINT_ALLOWED_EXT, PRINT_FILE_MAX_BYTES } from './print.config'

/** 表单字段（全部为字符串，与 Submission.formData 的形态一致）。 */
export interface PrintFormValues {
  building: string
  room: string
  wechat?: string
  remark?: string
}

/** 待上传文件的**描述**（不含 File 本体，便于单测与序列化）。 */
export interface PrintDraftFile {
  name: string
  size: number
}

export type ScreenResult = { ok: true; ext: string } | { ok: false; reason: string }

/**
 * 取扩展名：只看最后一个点，且把非字母数字剥掉。
 * `../../etc/passwd` 这类输入在这里只会得到 `''`（无点或点在末尾）或纯字母串，
 * 不会被当成路径使用 —— 真正的安全边界在服务端（文件名不入库、key 由 CSPRNG 生成）。
 */
export function fileExtOf(name: string): string {
  const s = String(name || '')
  // 先剥目录：'../../etc/passwd' 的"扩展名"不该是 'etcpasswd' ——
  // 看起来无害（匹配不上白名单同样会被拒），但它会把**路径片段**带进错误信息回显给用户。
  const base = s.replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot < 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 单个文件的准入判定。顺序：空 → 体积 → 扩展名。 */
export function screenFile(f: PrintDraftFile): ScreenResult {
  const name = String(f?.name || '')
  const size = Number(f?.size || 0)
  if (!name.trim()) return { ok: false, reason: '文件名无效' }
  if (size <= 0) return { ok: false, reason: '文件内容为空，请重新选择' }
  if (size > PRINT_FILE_MAX_BYTES) {
    return { ok: false, reason: `单个文件不能超过 ${Math.floor(PRINT_FILE_MAX_BYTES / 1024 / 1024)}MB` }
  }
  const ext = fileExtOf(name)
  if (!ext) return { ok: false, reason: '无法识别文件类型（缺少扩展名）' }
  if (!(PRINT_ALLOWED_EXT as readonly string[]).includes(ext)) {
    return { ok: false, reason: `不支持 .${ext} 格式` }
  }
  return { ok: true, ext }
}

/**
 * 批量准入：返回被接受的文件与逐条拒绝原因（不静默丢弃，用户要看得见哪张没进）。
 * 泛型保留调用方的真实类型（传 File[] 就回 File[]），否则调用方拿到 PrintDraftFile
 * 之后再传给 FileReader / FormData 会过不了类型 —— 那是强制每个调用方写一遍 as。
 */
export function screenFiles<T extends PrintDraftFile>(files: T[]): { accepted: T[]; rejected: { name: string; reason: string }[] } {
  const accepted: T[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const f of files || []) {
    const r = screenFile(f)
    if (r.ok) accepted.push(f)
    else rejected.push({ name: String(f?.name || '(未命名)'), reason: r.reason })
  }
  return { accepted, rejected }
}

/** 张数上限提示：返回 null 表示还能继续加。 */
export function overflowReason(current: number, adding: number): string | null {
  if (current + adding > MAX_PRINT_FILES) {
    return `最多上传 ${MAX_PRINT_FILES} 个文件（当前 ${current} 个）`
  }
  return null
}

export type ValidateResult = { ok: true } | { ok: false; field: string; reason: string }

/**
 * 提交前校验：楼栋号与房间号必填，微信号/备注选填；至少要有一个文件。
 * 字段值一律先 trim —— "全空格"要按没填处理（否则能绕过必填）。
 */
export function validatePrintForm(v: PrintFormValues, files: PrintDraftFile[]): ValidateResult {
  const building = String(v?.building || '').trim()
  const room = String(v?.room || '').trim()
  if (!building) return { ok: false, field: 'building', reason: '请填写楼栋号' }
  if (!room) return { ok: false, field: 'room', reason: '请填写房间号' }
  // 50 字上限与服务端 formData 的截断同值（submit 前截，避免用户以为存进去了）
  if (building.length > 50) return { ok: false, field: 'building', reason: '楼栋号过长' }
  if (room.length > 50) return { ok: false, field: 'room', reason: '房间号过长' }
  const wechat = String(v?.wechat || '').trim()
  if (wechat.length > 50) return { ok: false, field: 'wechat', reason: '微信号过长' }
  const remark = String(v?.remark || '').trim()
  if (remark.length > 200) return { ok: false, field: 'remark', reason: '备注请控制在 200 字以内' }
  if (!files || files.length === 0) return { ok: false, field: 'files', reason: '请上传至少一个文件' }
  if (files.length > MAX_PRINT_FILES) {
    return { ok: false, field: 'files', reason: `最多上传 ${MAX_PRINT_FILES} 个文件` }
  }
  return { ok: true }
}

/** 体积展示（<1MB 用 KB，否则用 MB，保留一位小数）。 */
export function formatBytes(bytes: number): string {
  const b = Number(bytes || 0)
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
