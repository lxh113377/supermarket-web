// 打印文件直传（R2）+ 内联降级。
//
// 主路径：multipart POST 到 `/upload`，服务端写 R2 并回 `r2:<key>`，D1 只存引用。
// 降级路径：上传端点不可达 / 返回 print_storage_unavailable / 本地 dev 没这条路由
//           ⇒ 小文件（≤ MAX_INLINE_UPLOAD_BYTES）转 base64 内联进提交体。
//
// 为什么必须有降级：R2 桶是**账号级开关**（Cloudflare Dashboard 未启用 R2 时 wrangler 建桶
// 直接报 code:10042），这个开关不在本仓控制范围内。没有降级的话，桶建的那一刻之前
// 打印页对顾客就是"永远传不上去"，而页面其余部分（3D 导航、表单）全都白做。
// 降级的代价由服务端 MAX_INLINE_PRINT_TOTAL_CHARS 兜底，不会把 D1 撑爆。

import { MAX_INLINE_UPLOAD_BYTES, PRINT_FILE_MAX_BYTES } from '../pages/print/print.config'

export interface PrintUploadedRef {
  /** 提交体的形态：`r2:<key>` 或 `data:<mime>;base64,...`。 */
  ref: string
  name: string
  size: number
  /** true = 走的是内联降级（UI 上要提示"文件较大时请稍后用微信补发"）。 */
  inline: boolean
}

function uploadBaseUrl(): string {
  // /upload 与 /pub 同一部署单元（Pages Functions），故复用公开端基址：
  // 取 ".../pub" 的目录级再拼 "/upload"，避免为一条路由新增一个环境变量
  // （多一个环境变量 = 多一处构建期漏配导致"线上按钮点了没反应"）。
  const pub = String(import.meta.env.VITE_CB_PUBLIC_API_BASE || '')
  if (!pub) return ''
  return pub.replace(/\/pub\/?$/, '') + '/upload'
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 直传一条路。
 * @returns 成功返回引用；**端点不可用**返回 null（调用方据此降级）；
 *          服务端**明确拒绝这个文件**（类型/体积/限流）则抛 Error —— 这一类必须让用户看见，
 *          降级只会把它变成"提交后才被服务端拒"，比当场报错更糟。
 */
async function tryDirect(base: string, file: File, signal?: AbortSignal): Promise<PrintUploadedRef | null> {
  const form = new FormData()
  form.append('file', file, String(file.name || ''))
  let res: Response
  try {
    res = await fetch(base, { method: 'POST', body: form, signal })
  } catch {
    return null // 断网 / 路由未部署 / 跨域被拦 ⇒ 不可达，降级
  }
  const data = await res.json().catch(() => null)
  // 拿不到结构化响应（dev server 的 404 页面、网关错误页）也算端点不可用
  if (!data || typeof data.code !== 'number') return null
  if (data.code === 0 && typeof data.data?.key === 'string') {
    return { ref: `r2:${data.data.key}`, name: String(file.name || ''), size: file.size, inline: false }
  }
  if (String(data.errorCode || '') === 'print_storage_unavailable') return null
  throw new Error(String(data.message || '文件上传失败，请重试'))
}

/**
 * 上传单个文件。失败时抛 Error（文案可直接展示给用户）。
 * @param signal 允许页面卸载 / 用户删除该文件时中止
 */
export async function uploadPrintFile(file: File, signal?: AbortSignal): Promise<PrintUploadedRef> {
  const base = uploadBaseUrl()
  if (base) {
    const direct = await tryDirect(base, file, signal)
    if (direct) return direct
  }
  if (file.size > MAX_INLINE_UPLOAD_BYTES) {
    throw new Error(`文件过大且云存储未就绪，请改用微信发送（内联上限 ${Math.floor(MAX_INLINE_UPLOAD_BYTES / 1024)}KB）`)
  }
  if (file.size > PRINT_FILE_MAX_BYTES) {
    throw new Error('文件超过 20MB 上限')
  }
  const dataUrl = await readAsDataUrl(file)
  return { ref: dataUrl, name: String(file.name || ''), size: file.size, inline: true }
}

/** 是否支持直接下载（后台用）：r2 引用需要配了公网基址才能拼出可点链接。 */
export function resolvePrintFileUrl(ref: string): string {
  const base = String(import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/+$/, '')
  if (base && ref.startsWith('r2:')) return `${base}/${ref.slice(3)}`
  return ''
}
