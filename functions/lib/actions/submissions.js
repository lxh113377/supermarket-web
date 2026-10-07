// 服务提交域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qRun, jparse, nowISO, genId, pick, insert } from '../db.js'
import { validateImages, validateSubmissionFiles, checkPublicText } from '../security.js'
import { SUBMISSION_FIELDS, MAX_STATEMENT_PAYLOAD_CHARS, MAX_SUBMISSION_FILES } from '../shared.js'
import { fail } from '../errors.js'

// 内联降级（R2 未就绪时文件本体入 D1）的两把尺。
// 数值不写 `_` 分隔：check-limit-provenance 的 C11 用 `const NAME = (\d+)` 抓盘上定义，
// `700_000` 会被读成 700 ⇒ 与登记册「定义 = 700000」对不上（同族坑见 shared.js 那行注释）。
const MAX_INLINE_PRINT_CHARS = 700000
const MAX_INLINE_PRINT_TOTAL_CHARS = 2000000

export async function createSubmission(DB, payload) {
  const clean = pick(payload, SUBMISSION_FIELDS)
  if (!clean.serviceId || !clean.serviceName) return fail('missing_service_info', '缺少服务信息')
  // 条数 cap（第三十五轮补）：此前「≤5 张」只写在 src/pages/ServiceFormPage.tsx 的拒绝分支里，
  // 服务端只查 scheme 与单张体积 ⇒ 直接 POST 可塞任意多张。值与前端同值，理由见 docs/limit-provenance.md。
  // 2026-10-07 由 5 抬到 9（打印服务要多页文档），常量移入 shared.js 与前端同一把尺。
  if (Array.isArray(clean.images) && clean.images.length > MAX_SUBMISSION_FILES) {
    return fail('too_many_images', `最多上传 ${MAX_SUBMISSION_FILES} 个文件`)
  }
  // 图片 scheme 白名单：仅 data:image/(jpeg|png|webp|gif);base64 或 https。
  // 打印服务（serviceId='print'）走单独的文件白名单：额外接受 r2:<key> 与文档类 data: URL。
  const isPrint = clean.serviceId === 'print'
  const cleanImages = isPrint ? validateSubmissionFiles(clean.images) : validateImages(clean.images)
  if (cleanImages === null) return fail('invalid_image', '文件格式无效')
  // 体积的两把尺：非打印服务仍是 R37-H2 那把 90,000 字符；打印服务走内联降级时放宽
  // —— 依据是本文件 :48 的一手实测「线上单条提交 images 最大 442KB 仍写成功」，说明
  // 100KB 只管语句文本、不含绑定参数，90,000 对内联文档是过紧的自定预算而非平台线。
  const imageChars = cleanImages.reduce((s, img) => s + img.length, 0)
  if (isPrint) {
    for (const img of cleanImages) {
      if (img.length > MAX_INLINE_PRINT_CHARS) {
        return fail('image_too_large', `单个文件过大（${img.length} 字符 > 预算 ${MAX_INLINE_PRINT_CHARS}）`)
      }
    }
    if (imageChars > MAX_INLINE_PRINT_TOTAL_CHARS) {
      return fail('payload_too_large', `文件合计 ${imageChars} 字符 > 预算 ${MAX_INLINE_PRINT_TOTAL_CHARS}：请减少张数或压小文件`)
    }
  } else {
    for (const img of cleanImages) {
      // 改前是 `2 * 1024 * 1024`（约平台单语句预算的 21 倍）⇒ 这条校验形同虚设，
      // 真实失败发生在平台层（用户看到的是提交失败而不是"图太大"）。R37-H2 统一到同一把尺。
      if (img.length > MAX_STATEMENT_PAYLOAD_CHARS) {
        return fail('image_too_large', `单张图片过大（${img.length} 字符 > 预算 ${MAX_STATEMENT_PAYLOAD_CHARS}）`)
      }
    }
    if (imageChars > MAX_STATEMENT_PAYLOAD_CHARS) {
      return fail('payload_too_large', `图片合计 ${imageChars} 字符 > 单语句预算 ${MAX_STATEMENT_PAYLOAD_CHARS}：请减少张数或压小图片`)
    }
  }
  const safeForm = {}
  if (clean.formData && typeof clean.formData === 'object') {
    for (const [k, v] of Object.entries(clean.formData)) {
      const key = String(k).slice(0, 50)
      const val = String(v || '').slice(0, 200)
      if (!checkPublicText(val, 200)) return fail('invalid_text', '表单内容无效')
      safeForm[key] = val
    }
  }
  const doc = {
    _id: genId('s_'), serviceId: String(clean.serviceId).slice(0, 50),
    serviceName: String(clean.serviceName).slice(0, 50), categoryId: String(clean.categoryId || '').slice(0, 50),
    categoryName: String(clean.categoryName || '').slice(0, 50), formData: safeForm, images: cleanImages,
    status: 'pending', createdAt: nowISO(),
  }
  await insert(DB, 'submissions', doc)
  return { code: 0, data: { id: doc._id } }
}

// 性能（2026-09-18）：列表接口不再下发 base64 图片。
// 实测线上 14 条提交 images 合计 1.22MB（单条最大 442KB），JSON 整包约 1.2MB，
// 手机 4G 下仅下载+解码就数秒卡顿（电脑宽带几乎无感）。列表只回传 imageCount，
// 原图改由 getSubmissionImages 按需单条拉取（点开才下载，且带本地缓存）。
export async function getSubmissions(DB) {
  const rows = await qAll(DB, `SELECT _id, serviceId, serviceName, categoryId, categoryName, formData, status, createdAt, updatedAt,
      CASE WHEN json_valid(images) THEN json_array_length(images) ELSE 0 END AS imageCount
    FROM submissions ORDER BY createdAt DESC LIMIT 500`)
  return {
    code: 0,
    data: rows.map((r) => ({
      ...r,
      formData: jparse(r.formData, {}),
      imageCount: Number(r.imageCount) || 0,
    })),
  }
}

// 按需拉取单条提交的原图（列表接口已剥离 images，避免整表 base64 全量下发）
export async function getSubmissionImages(DB, payload) {
  const submissionId = payload && payload.submissionId
  if (!submissionId) return fail('missing_submission_id', '缺少 submissionId')
  const rows = await qAll(DB, `SELECT images FROM submissions WHERE _id = ? LIMIT 1`, [String(submissionId)])
  if (!rows.length) return fail('submission_not_found', '提交不存在')
  return { code: 0, data: { images: jparse(rows[0].images, []) } }
}

export async function updateSubmissionStatus(DB, payload) {
  const { submissionId, status } = payload
  if (!submissionId) return fail('missing_submission_id', '缺少 submissionId')
  const res = await qRun(DB, `UPDATE submissions SET status = ?, updatedAt = ? WHERE _id = ?`, [status || 'done', nowISO(), submissionId])
  if (!res.meta?.changes) return fail('submission_not_found', '提交不存在')
  return { code: 0 }
}

export async function deleteSubmission(DB, payload) {
  const { submissionId } = payload
  if (!submissionId) return fail('missing_submission_id', '缺少 submissionId')
  await qRun(DB, `DELETE FROM submissions WHERE _id = ?`, [submissionId])
  return { code: 0 }
}
