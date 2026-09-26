// 评价域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qFirst, qRun, qBatch, jparse, nowISO, genId, pick, insert, insertStatement } from '../db.js'
import { validateImages, checkPublicText } from '../security.js'
import { REVIEW_FIELDS } from '../shared.js'

export async function getReviews(DB, payload) {
  const { productOrder } = payload
  if (productOrder == null) return { code: -1, message: '缺少 productOrder' }
  const rows = await qAll(DB,
    `SELECT _id, "user", rating, text, productOrder, createdAt, images
     FROM reviews WHERE productOrder = ? ORDER BY createdAt DESC LIMIT 500`,
    [Number(productOrder)])
  return { code: 0, data: rows.map((r) => ({ ...r, images: jparse(r.images, []) })) }
}

export async function addReview(DB, payload) {
  const clean = pick(payload, REVIEW_FIELDS)
  if (clean.productOrder == null) return { code: -1, message: '缺少 productOrder' }
  if (Array.isArray(clean.images) && clean.images.length > 3) return { code: -1, message: '最多上传 3 张图片' }
  // 图片 scheme 白名单：仅 data:image/(jpeg|png|webp|gif);base64 或 https
  const cleanImages = validateImages(clean.images)
  if (cleanImages === null) return { code: -1, message: '图片格式无效' }
  for (const img of cleanImages) {
    if (img.length > 800 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  // UGC 内容校验：长度上限 + 基础黑名单拦截（纵深防御的一种；最终 HTML 注入防线依赖渲染端 React 转义）
  if (!checkPublicText(clean.text, 500)) return { code: -1, message: '评价内容无效' }
  const doc = {
    _id: genId('r_'), productOrder: Number(clean.productOrder),
    user: String(clean.user || '匿名用户').slice(0, 20),
    rating: Math.max(1, Math.min(5, Number(clean.rating) || 5)),
    text: String(clean.text || '').slice(0, 500), images: cleanImages, createdAt: nowISO(),
  }
  await insert(DB, 'reviews', doc)
  return { code: 0, data: { _id: doc._id, id: doc._id, ...doc } }
}

export async function getAllReviews(DB) {
  const rows = await qAll(DB,
    `SELECT _id, "user", rating, text, productOrder, createdAt FROM reviews ORDER BY createdAt DESC LIMIT 1000`)
  return { code: 0, data: rows }
}

export async function deleteReview(DB, payload) {
  const { reviewId } = payload
  if (!reviewId) return { code: -1, message: '缺少 reviewId' }
  await qRun(DB, `DELETE FROM reviews WHERE _id = ?`, [reviewId])
  return { code: 0 }
}

export async function seedReviews(DB) {
  const count = await qFirst(DB, `SELECT COUNT(*) AS c FROM reviews`)
  if (count && count.c > 0) return { code: 0, data: { added: 0, skipped: true } }
  const SEED = [
    { productOrder: 1, user: '小明', rating: 5, text: '冰糖雪梨yyds，冰一下更好喝！' },
    { productOrder: 1, user: '阿杰', rating: 4, text: '甜度刚好，1L够喝一天' },
    { productOrder: 5, user: '茶茶', rating: 5, text: '康师傅绿茶永远的神，回购无数次' },
    { productOrder: 6, user: '路人甲', rating: 4, text: '冰红茶配泡面绝了' },
    { productOrder: 8, user: '养生青年', rating: 5, text: '东方树叶青柑普洱，无糖茶天花板' },
    { productOrder: 8, user: '打工人', rating: 4, text: '解腻神器，吃完食堂来一瓶' },
    { productOrder: 14, user: 'VC达人', rating: 5, text: '水溶C100酸酸甜甜，补充维C' },
    { productOrder: 16, user: '熬夜选手', rating: 5, text: '东鹏特饮期末周救命水' },
    { productOrder: 16, user: '考研人', rating: 4, text: '便宜大碗，提神效果不错' },
    { productOrder: 18, user: '健身哥', rating: 4, text: '500ml大瓶划算，运动前来一瓶' },
    { productOrder: 22, user: '可乐党', rating: 5, text: '冰可乐夏天必备，快乐水！' },
    { productOrder: 22, user: '宅男', rating: 5, text: '罐装就是比瓶装好喝，不接受反驳' },
    { productOrder: 24, user: '跑步人', rating: 5, text: '农夫山泉有点甜，1.5L运动够用' },
    { productOrder: 32, user: '吃货', rating: 5, text: '士力架横扫饥饿，下午续命必备' },
    { productOrder: 33, user: '薯片爱好者', rating: 4, text: '乐事原味永远经典，40g刚好不怕胖' },
    { productOrder: 38, user: '辣条王', rating: 5, text: '卫龙大面筋辣条yyds！' },
    { productOrder: 46, user: '深夜食堂', rating: 5, text: '白象方便面加个卤蛋，宵夜天花板' },
    { productOrder: 46, user: '省钱达人', rating: 4, text: '十三香味道不错，比食堂便宜多了' },
    { productOrder: 48, user: '早餐人', rating: 4, text: '乡巴佬卤蛋配泡面，简单但满足' },
    { productOrder: 49, user: '火腿肠粉丝', rating: 4, text: '双汇火腿肠烤一下更香' },
  ]
  // 20 条种子评价合成一次 batch 往返（第十四轮 D1 往返收口）：
  // 逐条 await 时 N 条 = N 次往返，免费档「每调用 50 次查询」的天花板会被这一个 action 吃掉五分之一。
  const docs = SEED.map((s) => ({
    _id: genId('r_'), productOrder: Number(s.productOrder), user: s.user,
    rating: s.rating, text: s.text, images: [], createdAt: nowISO(),
  }))
  await qBatch(DB, insertStatement(DB, docs, 'reviews'))
  return { code: 0, data: { added: docs.length } }
}
