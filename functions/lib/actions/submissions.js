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

export async function getSubmissions(DB) {
  const rows = await qAll(DB, `SELECT * FROM submissions ORDER BY createdAt DESC LIMIT 500`)
  return { code: 0, data: rows.map((r) => ({ ...r, formData: jparse(r.formData, {}), images: jparse(r.images, []) })) }
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
