const cloudbase = require('@cloudbase/node-sdk')
const {
  normalizeEvent,
  createRateLimiter,
  getClientIp,
  createOrderHandler,
  getReviewsHandler,
  createSubmissionHandler,
} = require('./shared')

// 环境 ID：CloudBase 会把变量名首字母小写化（ENV_ID → eNV_ID），需覆盖所有变体
// 安全：不设硬编码兜底，缺失时初始化失败并返回明确错误
const ENV_ID = process.env.ENV_ID || process.env.eNV_ID || process.env.env_id || ''

let app = null
let db = null
if (!ENV_ID) {
  console.error('[public-api] FATAL: ENV_ID 环境变量未配置，请在 CloudBase 控制台设置')
} else {
  try {
    app = cloudbase.init({ env: ENV_ID })
    db = app.database()
  } catch (e) {
    console.error('[public-api] cloudbase init failed:', e && e.message)
  }
}

// 公开接口限流
const checkPublicRateLimit = createRateLimiter(60000, 20, '操作过于频繁，请稍后再试')

exports.main = async (event, context) => {
  const ev = normalizeEvent(event)
  const { action, payload } = ev
  const pl = payload || {}

  if (!app || !db) return { code: -1, message: '云服务初始化失败，请检查 ENV_ID 环境变量' }

  // 写操作限流
  const writeActions = ['createOrder', 'createSubmission']
  if (writeActions.includes(action)) {
    const ip = getClientIp(context, event)
    const rateErr = checkPublicRateLimit(ip)
    if (rateErr) return rateErr
  }

  try {
    switch (action) {
      case 'getPublicProducts': {
        const res = await db
          .collection('sm_products')
          .where({ enabled: true })
          .orderBy('order', 'asc')
          .limit(200)
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

      case 'createOrder':
        return await createOrderHandler(db, pl)

      case 'getReviews':
        return await getReviewsHandler(db, pl)

      case 'createSubmission':
        return await createSubmissionHandler(db, pl)

      default:
        return { code: -1, message: '未知操作（public-api 仅支持公开接口）' }
    }
  } catch (err) {
    console.error('[public-api]', action, err)
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}
