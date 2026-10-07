// 打印服务文件直传端点：POST /upload（multipart/form-data，一次一个文件）
//
// 为什么单独一条路由而不挂在 /pub 的 action 上：
//   /pub 是 JSON 通道，文件走 base64 会先膨胀 33% 再整包进内存；打印一次可能交 9 个
//   合计十几 MB 的文档，那条路既撞请求体又撞 Worker 内存。multipart 让文件以流的形式
//   过 Worker 直写 R2，内存里只留一份。
// 返回 `r2:<key>`（不透明引用），由 createSubmission 存进 D1；渲染/下载侧走
// src/utils/reviewImages.ts 的可信基址拼接，key 永不拼进可执行上下文。
//
// 路由不是 /pub 的 action ⇒ 不在 PUBLIC_ACTIONS 白名单口径内（那份表管的是 JSON action 分发），
// 本端点的公开性由「只写、不读、限流同 RATE_PUBLIC_WRITE」独立承担。

import { logError, traceIdOf } from './lib/logger.js'
import { resolveCorsHeaders, getClientIp, RATE_PUBLIC_WRITE } from './lib/security.js'
// checkRate 只从 backend.js 具名导出（security.js 里它是模块内私有），沿用既有出口，不复制一份
import { checkRate } from './lib/backend.js'
import { apiResponse, fail, withTrace } from './lib/errors.js'
import { PRINT_FILE_MAX_BYTES } from './lib/shared.js'

// 扩展名白名单（与前端 src/pages/print/print.config.ts 的 PRINT_ALLOWED_EXT 同值，
// 两侧等值由 tests/printCapParity.test.ts 钉住）。只认扩展名不认 MIME：MIME 由客户端
// 自报、可伪造，扩展名同样可伪造 —— 两道都过是因为真正的安全边界在"只存不执行"：
// key 不进 HTML、下载一律带 Content-Disposition: attachment。
const ALLOWED_EXT = [
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif',
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt',
]

const EXT_CONTENT_TYPE = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', gif: 'image/gif', pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

/** 文件名只取扩展名用，主体一律丢弃重生成 —— 防路径穿越、防同名覆盖、防畸形字符进 key。 */
function unsafeExtOf(name) {
  const s = String(name || '')
  const dot = s.lastIndexOf('.')
  if (dot < 0 || dot === s.length - 1) return ''
  return s.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function randomId() {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { headers: resolveCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env }) {
  const cors = resolveCorsHeaders(request, env)
  const trace = traceIdOf(request)
  const ip = getClientIp(request)

  // 与顾客端写操作同档（20 次/60s/IP）：上传比下单更贵（带宽 + R2 写），
  // 不另立更松的档，否则一个脚本就能把 D1 写配额与 R2 请求数同时打满。
  const limited = await checkRate(env.DB, env.RATE_KV, `rate:print-upload:${ip}`, RATE_PUBLIC_WRITE.windowMs, RATE_PUBLIC_WRITE.max)
  if (limited) return apiResponse(withTrace(limited, trace), cors)

  const bucket = env.PRINT_FILES
  if (!bucket || typeof bucket.put !== 'function') {
    // 桶未绑定 ≠ 代码坏了：本地 dev、桶还没建、绑定名写错都会走到这。
    // 前端据此切到内联降级路径（小文件入 D1），而不是让用户卡在"上传失败"。
    logError('upload', 'PRINT_FILES 未绑定，打印文件直传不可用', { trace })
    return apiResponse(withTrace(fail('print_storage_unavailable', '文件存储未就绪，请改用小文件提交'), trace), cors)
  }

  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > PRINT_FILE_MAX_BYTES) {
    return apiResponse(withTrace(fail('print_file_too_large', `单个文件不能超过 ${Math.floor(PRINT_FILE_MAX_BYTES / 1024 / 1024)}MB`), trace), cors)
  }

  let form
  try {
    form = await request.formData()
  } catch (e) {
    logError('upload', 'multipart 解析失败', { trace, err: e })
    return apiResponse(withTrace(fail('invalid_params', '上传请求体无效'), trace), cors)
  }
  const file = form.get('file')
  if (!file || typeof file.arrayBuffer !== 'function') {
    return apiResponse(withTrace(fail('invalid_params', '缺少文件字段'), trace), cors)
  }
  const ext = unsafeExtOf(file.name)
  if (!ALLOWED_EXT.includes(ext)) {
    return apiResponse(withTrace(fail('print_file_type_denied', `不支持的文件类型（.${ext || '未知'}）`), trace), cors)
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > PRINT_FILE_MAX_BYTES) {
    return apiResponse(withTrace(fail('print_file_too_large', `单个文件不能超过 ${Math.floor(PRINT_FILE_MAX_BYTES / 1024 / 1024)}MB`), trace), cors)
  }

  // key 结构：print/<yyyy-mm>/<24位随机>.<ext> —— 目录按月份分，便于日后按生命周期清理；
  // 随机段由 CSPRNG 生成，不可枚举（防遍历他人文件）。
  const month = new Date().toISOString().slice(0, 7)
  const key = `print/${month}/${randomId()}.${ext}`
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: EXT_CONTENT_TYPE[ext] || 'application/octet-stream' },
    })
  } catch (e) {
    logError('upload', 'R2 写入失败', { trace, key, err: e })
    return apiResponse(withTrace(fail('print_storage_unavailable', '文件写入失败，请重试'), trace), cors)
  }
  return apiResponse(withTrace({
    code: 0,
    data: { key, name: String(file.name || '').slice(0, 120), size: bytes.byteLength, ext },
  }, trace), cors)
}
