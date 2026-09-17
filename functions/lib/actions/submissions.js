// 服务提交域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qRun, jparse, nowISO, genId, pick, insert } from '../db.js'
import { validateImages, checkPublicText } from '../security.js'
import { SUBMISSION_FIELDS } from '../shared.js'

export async function createSubmission(DB, payload) {
  const clean = pick(payload, SUBMISSION_FIELDS)
  if (!clean.serviceId || !clean.serviceName) return { code: -1, message: '缺少服务信息' }
  // 图片 scheme 白名单：仅 data:image/(jpeg|png|webp|gif);base64 或 https
  const cleanImages = validateImages(clean.images)
  if (cleanImages === null) return { code: -1, message: '图片格式无效' }
  for (const img of cleanImages) {
    if (img.length > 2 * 1024 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  const safeForm = {}
  if (clean.formData && typeof clean.formData === 'object') {
    for (const [k, v] of Object.entries(clean.formData)) {
      const key = String(k).slice(0, 50)
      const val = String(v || '').slice(0, 200)
      if (!checkPublicText(val, 200)) return { code: -1, message: '表单内容无效' }
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
  if (!submissionId) return { code: -1, message: '缺少 submissionId' }
  const rows = await qAll(DB, `SELECT images FROM submissions WHERE _id = ? LIMIT 1`, [String(submissionId)])
  if (!rows.length) return { code: -1, message: '提交不存在' }
  return { code: 0, data: { images: jparse(rows[0].images, []) } }
}

export async function updateSubmissionStatus(DB, payload) {
  const { submissionId, status } = payload
  if (!submissionId) return { code: -1, message: '缺少 submissionId' }
  const res = await qRun(DB, `UPDATE submissions SET status = ?, updatedAt = ? WHERE _id = ?`, [status || 'done', nowISO(), submissionId])
  if (!res.meta?.changes) return { code: -1, message: '提交不存在' }
  return { code: 0 }
}

export async function deleteSubmission(DB, payload) {
  const { submissionId } = payload
  if (!submissionId) return { code: -1, message: '缺少 submissionId' }
  await qRun(DB, `DELETE FROM submissions WHERE _id = ?`, [submissionId])
  return { code: 0 }
}
