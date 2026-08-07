const cloudbase = require('@cloudbase/node-sdk')
const {
  normalizeEvent: sharedNormalizeEvent,
  createRateLimiter,
  getClientIp,
  createOrderHandler,
  getReviewsHandler,
  createSubmissionHandler,
  ensureCollection: sharedEnsureCollection,
  pickFields,
  PRODUCT_FIELDS,
  REVIEW_FIELDS,
} = require('./shared')

// 环境 ID：CloudBase 会把变量名首字母小写化（ENV_ID → eNV_ID），需覆盖所有变体
// 安全：不设硬编码兜底，缺失时初始化失败并返回明确错误
const ENV_ID = process.env.ENV_ID || process.env.eNV_ID || process.env.env_id || ''
// CloudBase 环境变量名首字母会被小写化（ADMIN_KEY → aDMIN_KEY）
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.aDMIN_KEY || ''

// 延迟初始化，避免模块加载阶段因环境变量缺失而直接崩（"0 code exit unexpected"）
let app = null
let db = null
if (!ENV_ID) {
  console.error('[admin-api] FATAL: ENV_ID 环境变量未配置，请在 CloudBase 控制台设置')
} else {
  try {
    app = cloudbase.init({ env: ENV_ID })
    db = app.database()
  } catch (e) {
    console.error('[admin-api] cloudbase init failed:', e && e.message)
  }
}

// HTTP 触发会把请求体包成 { headers, body: "<json字符串>", ... }，这里统一归一化
const normalizeEvent = sharedNormalizeEvent

// --- 频率限制（内存级，云函数实例存活期间有效） ---
const checkRateLimit = createRateLimiter(60000, 5, '操作过于频繁，请1分钟后再试')
const checkPublicRateLimit = createRateLimiter(60000, 20, '操作过于频繁，请稍后再试')

function checkAuth(rawEvent, adminKey, action) {
  // 以下为公开操作，顾客可直接调用
  const publicActions = ['createOrder', 'getReviews', 'createSubmission', 'getPublicProducts', 'getPublicCategories']
  if (publicActions.includes(action)) return null
  if (!ADMIN_KEY) return { code: -1, message: '服务未配置 ADMIN_KEY' }
  if (adminKey !== ADMIN_KEY) return { code: -1, message: '密钥错误' }
  return null
}

function now() {
  return new Date()
}

// 自动创建集合（不存在则建）
async function ensureCollection(name) {
  return sharedEnsureCollection(db, name)
}

// 导出纯逻辑供单测真实导入（不依赖云环境，避免测试复制逻辑导致失真）
exports.pickFields = pickFields
exports.PRODUCT_FIELDS = PRODUCT_FIELDS
exports.checkAuth = checkAuth

exports.main = async (event, context) => {
  const ev = normalizeEvent(event)
  const { action, adminKey, payload } = ev
  const pl = payload || {}

  const authErr = checkAuth(event, adminKey, action)
  if (authErr) return authErr

  if (!app || !db) return { code: -1, message: '云服务初始化失败，请检查 ENV_ID' }

  // 公开写操作限流
  const publicWriteActions = ['createOrder', 'createSubmission']
  if (publicWriteActions.includes(action)) {
    const ip = getClientIp(context, event)
    const rateErr = checkPublicRateLimit(ip)
    if (rateErr) return rateErr
  }

  try {
    switch (action) {
      case 'login': {
        // P1#5: 频率限制防暴力破解
        const ip = getClientIp(context, event)
        const rateErr = checkRateLimit(ip)
        if (rateErr) return rateErr
        if (!adminKey) return { code: -1, message: '缺少 adminKey' }
        if (adminKey !== ADMIN_KEY) return { code: -1, message: '密钥错误' }
        return { code: 0 }
      }

      case 'verifyKey': {
        return { code: 0 }
      }

      case 'getProducts': {
        const res = await db.collection('sm_products').orderBy('order', 'asc').limit(1000).get()
        return { code: 0, data: res.data || [] }
      }

      case 'createProduct': {
        const data = pickFields(pl, PRODUCT_FIELDS)
        data.enabled = data.enabled !== false
        data.createdAt = now()
        data.updatedAt = now()
        const res = await db.collection('sm_products').add(data)
        return { code: 0, data: res }
      }

      case 'updateProduct': {
        const { productId } = pl
        if (!productId) return { code: -1, message: '缺少 productId' }
        const data = pickFields(pl, PRODUCT_FIELDS)
        data.updatedAt = now()
        await db.collection('sm_products').doc(productId).update(data)
        return { code: 0 }
      }

      case 'deleteProduct': {
        const { productId } = pl
        if (!productId) return { code: -1, message: '缺少 productId' }
        await db.collection('sm_products').doc(productId).remove()
        return { code: 0 }
      }

      case 'deleteOrder': {
        const { orderId } = pl
        if (!orderId) return { code: -1, message: '缺少 orderId' }
        await db.collection('sm_orders').doc(orderId).remove()
        return { code: 0 }
      }

      case 'updateOrderStatus': {
        const { orderId, status } = pl
        if (!orderId || !['pending', 'paid', 'cancelled'].includes(status)) {
          return { code: -1, message: '参数无效' }
        }
        await db
          .collection('sm_orders')
          .doc(orderId)
          .update({ status, updatedAt: now() })
        return { code: 0 }
      }

      // 服务端重算金额：防客户端篡改价格
      case 'createOrder':
        return await createOrderHandler(db, pl)

      case 'recalculateOrders': {
        // 优化：原 .limit(1000).get() 只处理前 1000 条，订单超量会漏算。
        // 改为按 _id 排序分页循环，直到扫完所有订单。
        const BATCH = 1000
        let processed = 0
        let fixed = 0
        while (true) {
          const res = await db
            .collection('sm_orders')
            .orderBy('_id', 'asc')
            .skip(processed)
            .limit(BATCH)
            .get()
          if (!res.data || res.data.length === 0) break
          const toFix = []
          for (const o of res.data) {
            const total = (o.items || []).reduce(
              (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
              0,
            )
            const rounded = Math.round(total * 100) / 100
            if (o.totalAmount == null || Math.abs(o.totalAmount - rounded) > 0.01) {
              toFix.push({ id: o._id, totalAmount: rounded })
            }
          }
          // 分批并发写入（每批20条）
          for (let i = 0; i < toFix.length; i += 20) {
            const batch = toFix.slice(i, i + 20)
            await Promise.all(
              batch.map(item =>
                db.collection('sm_orders').doc(item.id).update({ totalAmount: item.totalAmount, updatedAt: now() })
              )
            )
            fixed += batch.length
          }
          processed += res.data.length
          if (res.data.length < BATCH) break
        }
        return { code: 0, data: { total: processed, fixed } }
      }

      case 'getOrders': {
        const page = Math.max(1, Number(pl.page) || 1)
        const pageSize = Math.min(100, Math.max(1, Number(pl.pageSize) || 50))
        const countRes = await db.collection('sm_orders').count()
        const res = await db
          .collection('sm_orders')
          .orderBy('createdAt', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        return { code: 0, data: res.data, total: countRes.total, page, pageSize }
      }

      case 'getPublicProducts': {
        const res = await db
          .collection('sm_products')
          .where({ enabled: true })
          .orderBy('order', 'asc')
          .limit(1000)
          .field({ _id: true, name: true, spec: true, price: true, image: true, order: true, subcategories: true, enabled: true, description: true })
          .get()
        return { code: 0, data: res.data }
      }

      case 'getPublicCategories': {
        const res = await db
          .collection('sm_categories')
          .orderBy('order', 'asc')
          .limit(200)
          .get()
        return { code: 0, data: res.data }
      }

      // ---------- 评价管理 ----------
      case 'getAllReviews': {
        await ensureCollection('sm_reviews')
        const res = await db
          .collection('sm_reviews')
          .orderBy('createdAt', 'desc')
          .limit(1000)
          .get()
        return { code: 0, data: res.data }
      }

      case 'getReviews':
        return await getReviewsHandler(db, pl)

      case 'addReview': {
        // 白名单收敛输入，只取允许字段，丢弃注入的 _id/status/role 等
        const { productOrder, user, rating, text } = pickFields(pl, REVIEW_FIELDS)
        if (productOrder == null) return { code: -1, message: '缺少 productOrder' }
        await ensureCollection('sm_reviews')
        const doc = {
          productOrder: Number(productOrder),
          user: String(user || '管理员').slice(0, 20),
          rating: Math.max(1, Math.min(5, Number(rating) || 5)),
          text: String(text || '').slice(0, 500),
          createdAt: now(),
        }
        const res = await db.collection('sm_reviews').add(doc)
        return { code: 0, data: { id: res.id || res._id, ...doc } }
      }

      case 'deleteReview': {
        const { reviewId } = pl
        if (!reviewId) return { code: -1, message: '缺少 reviewId' }
        await ensureCollection('sm_reviews')
        await db.collection('sm_reviews').doc(reviewId).remove()
        return { code: 0 }
      }

      // ---------- 服务表单提交 ----------
      case 'createSubmission':
        return await createSubmissionHandler(db, pl)

      case 'getSubmissions': {
        await ensureCollection('sm_submissions')
        const res = await db
          .collection('sm_submissions')
          .orderBy('createdAt', 'desc')
          .limit(500)
          .get()
        return { code: 0, data: res.data }
      }

      case 'updateSubmissionStatus': {
        const { submissionId, status } = pl
        if (!submissionId) return { code: -1, message: '缺少 submissionId' }
        await ensureCollection('sm_submissions')
        await db.collection('sm_submissions').doc(submissionId).update({ status: status || 'done', updatedAt: now() })
        return { code: 0 }
      }

      case 'deleteSubmission': {
        const { submissionId } = pl
        if (!submissionId) return { code: -1, message: '缺少 submissionId' }
        await ensureCollection('sm_submissions')
        await db.collection('sm_submissions').doc(submissionId).remove()
        return { code: 0 }
      }

      default:
        return { code: -1, message: '未知操作' }
    }
  } catch (err) {
    console.error('[admin-api]', action, err)
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}
