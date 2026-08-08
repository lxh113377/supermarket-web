const cloudbase = require('@cloudbase/node-sdk')
const {
  normalizeEvent: sharedNormalizeEvent,
  createRateLimiter,
  createDistributedRateLimiter,
  getClientIp,
  createOrderHandler,
  getReviewsHandler,
  addReviewHandler,
  createSubmissionHandler,
  ensureCollection: sharedEnsureCollection,
  pickFields,
  PRODUCT_FIELDS,
} = require('./shared')
const {
  EVENT_TYPES,
  logSecurityEvent,
  keyFingerprint,
  getUserAgent,
  genReqId,
} = require('./security')
const { SEED_REVIEWS } = require('./seed-reviews')

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
// 【F-01 修复 + P0-4】鉴权失败专用限流（比公开接口更严格）。
// 此前 checkAuth 在 main 第 84 行先于一切限流执行，错误密钥可无限速率爆破（verifyKey oracle）。
const checkAuthFailRateLimit = createRateLimiter(60000, 5, '尝试过于频繁，请稍后再试')
// 【F-03 修复 · P1-C3】分布式鉴权失败限流：基于 sm_security_events 集合计数，
// 解决内存 Map 多实例可绕过问题（多实例并发时有效阈值 = 5 × 实例数）。
// 与内存版互补：内存版快但单实例；分布式版跨实例，天然产生遥测。
const checkDistributedAuthFail = createDistributedRateLimiter(60000, 5, '尝试过于频繁，请稍后再试')

function checkAuth(rawEvent, adminKey, action) {
  // 以下为公开操作，顾客可直接调用
  const publicActions = ['createOrder', 'getReviews', 'createSubmission', 'addPublicReview', 'getPublicProducts', 'getPublicCategories']
  if (publicActions.includes(action)) return null
  if (!ADMIN_KEY) return { code: -1, message: '服务未配置 ADMIN_KEY' }
  if (adminKey !== ADMIN_KEY) return { code: -1, message: '密钥错误' }
  return null
}

// 【R-010 数据源】部署配置自检：占位符未替换 / 密钥过弱 = 后台等于无密码
function assessAdminKeyRisk(key) {
  if (!key) return { risk: true, reason: 'ADMIN_KEY 未配置' }
  if (/^\$\{.*\}$/.test(key)) return { risk: true, reason: '占位符未被替换（部署时未导出环境变量）' }
  if (key.length < 12) return { risk: true, reason: `密钥过短（${key.length} 字符）` }
  const weak = ['admin', 'password', '123456', 'test', 'admin123', 'changeme']
  if (weak.includes(key.toLowerCase())) return { risk: true, reason: '使用了常见弱密钥' }
  return { risk: false }
}

const KEY_RISK = assessAdminKeyRisk(ADMIN_KEY)
if (KEY_RISK.risk) {
  console.error('[admin-api] SECURITY:', KEY_RISK.reason)
}

// 【P0-4】启动配置自检事件只上报一次（每次冷启动最多一条 critical）
let keyRiskReported = false

function now() {
  return new Date()
}

// 自动创建集合（不存在则建）
async function ensureCollection(name) {
  return sharedEnsureCollection(db, name)
}

// 从 doc().get() 结果中提取首条文档（SDK 不同版本可能返回数组或对象）
function firstDoc(res) {
  if (!res) return null
  if (Array.isArray(res.data)) return res.data[0] || null
  return res.data || null
}

// 导出纯逻辑供单测真实导入（不依赖云环境，避免测试复制逻辑导致失真）
exports.pickFields = pickFields
exports.PRODUCT_FIELDS = PRODUCT_FIELDS
exports.checkAuth = checkAuth

// 幂等导入 20 条种子评价（管理 action seedReviews 与单测共用同一实现）
exports.seedReviewsHandler = async (db) => {
  await sharedEnsureCollection(db, 'sm_reviews')
  const countRes = await db.collection('sm_reviews').count()
  if (countRes.total > 0) return { code: 0, data: { added: 0, skipped: true } }
  let added = 0
  for (const seed of SEED_REVIEWS) {
    await db.collection('sm_reviews').add({ ...seed, createdAt: now() })
    added += 1
  }
  return { code: 0, data: { added } }
}

/**
 * 【P0-4 ④】管理写操作审计包装器（STRIDE 中的 R 抵赖：回答"什么时间、从哪个 IP、改了哪个文档"）。
 *
 * @param {object} ctx  审计上下文：{ db, action, ip, ua, reqId, keyFp }
 * @param {object} meta 操作元数据：{ target, targetId, op, destructive, extra? }
 * @param {Function} fn 实际业务函数（async）
 */
async function auditedWrite(ctx, meta, fn) {
  const startedAt = Date.now()
  try {
    const result = await fn()
    await logSecurityEvent(ctx.db, {
      eventType: EVENT_TYPES.ADMIN_ACTION,
      severity: meta.destructive ? 'high' : 'low',
      fn: 'admin-api',
      action: ctx.action, ip: ctx.ip, ua: ctx.ua, reqId: ctx.reqId,
      authResult: 'success', keyFp: ctx.keyFp,
      detail: {
        target: meta.target,
        targetId: meta.targetId,
        op: meta.op,
        destructive: !!meta.destructive,
        ok: result && result.code === 0,
        costMs: Date.now() - startedAt,
        // 规则扩展字段（如 R-007 的 oldPrice/newPrice/priceDelta/priceDeltaPct）原样透传
        ...(meta.extra || {}),
      },
    })
    return result
  } catch (e) {
    await logSecurityEvent(ctx.db, {
      eventType: EVENT_TYPES.INTERNAL_ERROR, severity: 'medium',
      fn: 'admin-api', action: ctx.action, ip: ctx.ip, reqId: ctx.reqId,
      detail: { target: meta.target, op: meta.op, err: String(e && e.message).slice(0, 200) },
    })
    throw e
  }
}

exports.main = async (event, context) => {
  const ev = normalizeEvent(event)
  const { action, adminKey, payload } = ev
  const pl = payload || {}

  const ip = getClientIp(context, event)
  const ua = getUserAgent(context, event)
  const reqId = genReqId()

  const authErr = checkAuth(event, adminKey, action)
  if (authErr) {
    // 【F-01 修复】所有非公开 action 的鉴权失败路径统一限流（原来只保护 login，
    // 且 login 限流在 checkAuth 之后执行——错误密钥请求根本到不了那里）
    // 【F-03 修复】双层限流：内存版（快，单实例）+ 分布式版（跨实例，基于 sm_security_events 计数）
    const memRateErr = checkAuthFailRateLimit(ip)
    const distRateErr = await checkDistributedAuthFail(db, ip)
    const rateErr = memRateErr || distRateErr

    // 【P0-4 ①】鉴权失败必须留痕（爆破检测核心数据源，R-001/002/003）
    // 注意：此处可能在 db 初始化检查之前调用；security.js 内部有 if (!db) return 守卫
    await logSecurityEvent(db, {
      eventType: EVENT_TYPES.AUTH_FAIL,
      severity: 'medium',
      fn: 'admin-api',
      action, ip, ua, reqId,
      authResult: 'fail',
      keyFp: keyFingerprint(adminKey),   // ← 区分误操作与爆破的关键
      detail: {
        reason: authErr.message,
        rateLimited: !!rateErr,
        rateLimitedBy: rateErr ? (memRateErr ? 'memory' : 'distributed') : null,
        ipMissing: ip === 'unknown',      // F-07：无法归因本身是信号
      },
    })

    return rateErr || authErr
  }

  if (!app || !db) return { code: -1, message: '云服务初始化失败，请检查 ENV_ID' }

  // 【P0-4 ⑦ / R-010】启动配置自检：占位符未替换 / 密钥过弱 = 后台等于无密码
  if (KEY_RISK.risk && !keyRiskReported) {
    keyRiskReported = true
    await logSecurityEvent(db, {
      eventType: EVENT_TYPES.CONFIG_RISK, severity: 'critical',
      fn: 'admin-api', action: 'startup', ip, ua, reqId,
      detail: { reason: KEY_RISK.reason },
    })
  }

  // 公开写操作限流
  const publicWriteActions = ['createOrder', 'createSubmission', 'addPublicReview']
  if (publicWriteActions.includes(action)) {
    const rateErr = checkPublicRateLimit(ip)
    if (rateErr) {
      // 【P0-4 ③】限流触发留痕
      await logSecurityEvent(db, {
        eventType: EVENT_TYPES.RATELIMIT_TRIP, severity: 'medium',
        fn: 'admin-api', action, ip, ua, reqId,
        detail: { limiter: 'publicWrite' },
      })
      return rateErr
    }
  }

  try {
    switch (action) {
      case 'login': {
        // P1#5: 频率限制防暴力破解（正确密钥的重复登录走这里；错误密钥已在 checkAuth 层被 authFail 限流拦截）
        const rateErr = checkRateLimit(ip)
        if (rateErr) {
          // 【P0-4 ③】限流触发留痕
          await logSecurityEvent(db, {
            eventType: EVENT_TYPES.RATELIMIT_TRIP, severity: 'medium',
            fn: 'admin-api', action, ip, ua, reqId,
            detail: { limiter: 'login' },
          })
          return rateErr
        }
        if (!adminKey) return { code: -1, message: '缺少 adminKey' }
        if (adminKey !== ADMIN_KEY) {
          // 失败已在 checkAuth 层记录，此处不重复
          return { code: -1, message: '密钥错误' }
        }
        // 【P0-4 ②】鉴权成功也要留痕——没有成功基线，就无法回答"这个 IP 以前来过吗"（R-003）
        await logSecurityEvent(db, {
          eventType: EVENT_TYPES.AUTH_SUCCESS, severity: 'info',
          fn: 'admin-api', action, ip, ua, reqId,
          authResult: 'success', keyFp: keyFingerprint(adminKey),
        })
        return { code: 0 }
      }

      case 'verifyKey': {
        // 正确密钥已通过 checkAuth；此处补一条鉴权成功基线。
        // verifyKey 是高频探测目标（F-01 oracle），错误密钥的失败与限流已在 checkAuth 层处理。
        await logSecurityEvent(db, {
          eventType: EVENT_TYPES.AUTH_SUCCESS, severity: 'info',
          fn: 'admin-api', action, ip, ua, reqId,
          authResult: 'success', keyFp: keyFingerprint(adminKey),
        })
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
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_products', targetId: null, op: 'create', destructive: false },
          async () => {
            const res = await db.collection('sm_products').add(data)
            return { code: 0, data: res }
          }
        )
      }

      case 'updateProduct': {
        const { productId } = pl
        if (!productId) return { code: -1, message: '缺少 productId' }
        const data = pickFields(pl, PRODUCT_FIELDS)
        data.updatedAt = now()
        // 【R-007 数据源】读取旧价格用于价格异常篡改检测（P1 规则；此处仅收集，不改变业务）
        let oldPrice = null
        const newPrice = 'price' in data && data.price != null ? Number(data.price) : null
        if ('price' in data) {
          try {
            const old = await db.collection('sm_products').doc(productId).get()
            const oldDoc = firstDoc(old)
            oldPrice = oldDoc && oldDoc.price != null ? Number(oldDoc.price) : null
          } catch { oldPrice = null }
        }
        const priceDelta = oldPrice != null && newPrice != null
          ? Math.round((newPrice - oldPrice) * 100) / 100
          : null
        const priceDeltaPct = oldPrice != null && newPrice != null && oldPrice !== 0
          ? Math.round(((newPrice - oldPrice) / Math.abs(oldPrice)) * 1000) / 10
          : null
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          {
            target: 'sm_products', targetId: productId, op: 'update', destructive: false,
            extra: { oldPrice, newPrice, priceDelta, priceDeltaPct },
          },
          async () => {
            await db.collection('sm_products').doc(productId).update(data)
            return { code: 0 }
          }
        )
      }

      case 'deleteProduct': {
        const { productId } = pl
        if (!productId) return { code: -1, message: '缺少 productId' }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_products', targetId: productId, op: 'delete', destructive: true },
          async () => {
            await db.collection('sm_products').doc(productId).remove()
            return { code: 0 }
          }
        )
      }

      case 'deleteOrder': {
        const { orderId } = pl
        if (!orderId) return { code: -1, message: '缺少 orderId' }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_orders', targetId: orderId, op: 'delete', destructive: true },
          async () => {
            await db.collection('sm_orders').doc(orderId).remove()
            return { code: 0 }
          }
        )
      }

      case 'updateOrderStatus': {
        const { orderId, status } = pl
        if (!orderId || !['pending', 'paid', 'cancelled'].includes(status)) {
          return { code: -1, message: '参数无效' }
        }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_orders', targetId: orderId, op: 'update', destructive: false },
          async () => {
            await db
              .collection('sm_orders')
              .doc(orderId)
              .update({ status, updatedAt: now() })
            return { code: 0 }
          }
        )
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
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_orders', targetId: null, op: 'recalc', destructive: false },
          async () => {
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
        )
      }

      case 'getOrders': {
        const page = Math.max(1, Number(pl.page) || 1)
        const pageSize = Math.min(100, Math.max(1, Number(pl.pageSize) || 50))
        // 优化：去掉全表 count()（每次翻页都全集合扫描），改用 hasMore 推断
        // 多取 1 条：如果返回 > pageSize 说明还有下一页，裁掉多余的那条
        const res = await db
          .collection('sm_orders')
          .orderBy('createdAt', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize + 1)
          // 性能：订单列表卡片仅展示 房间号/商品/金额/状态/时间，绝不展示付款截图。
          // paymentScreenshot 是 base64 大图，缺省 .get() 全量回传会显著撑大载荷。
          // 显式投影排除它（其余字段均被列表/复制/CSV 用到，保留）。
          .field({ _id: true, roomNumber: true, items: true, totalAmount: true, status: true, createdAt: true, wechat: true, remark: true, updatedAt: true })
          .get()
        const allData = res.data || []
        const hasMore = allData.length > pageSize
        const data = hasMore ? allData.slice(0, pageSize) : allData
        // 【R-004 数据源】敏感集合读取留痕（订单含房间号/微信号/付款截图，批量拖取是可检测的）
        await logSecurityEvent(db, {
          eventType: EVENT_TYPES.ADMIN_ACTION, severity: 'info',
          fn: 'admin-api', action, ip, ua, reqId,
          authResult: 'success', keyFp: keyFingerprint(adminKey),
          detail: { target: 'sm_orders', op: 'read', destructive: false, count: data.length, page, pageSize },
        })
        return { code: 0, data, hasMore, page, pageSize }
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
        // 性能：管理评价列表只渲染 user/rating/text/createdAt/productOrder，
        // 绝不展示 images（base64 大图）。缺省 .get() 会把整篇文档（含 base64）全量传回，
        // 评价一多就是数 MB 载荷 → 传输慢 + JSON 解析卡。这里显式投影砍掉 images。
        const res = await db
          .collection('sm_reviews')
          .orderBy('createdAt', 'desc')
          .limit(1000)
          .field({ _id: true, user: true, rating: true, text: true, productOrder: true, createdAt: true })
          .get()
        return { code: 0, data: res.data }
      }

      case 'getReviews':
        return await getReviewsHandler(db, pl)

      case 'addPublicReview':
        // 顾客公开提交评价（与 addReview 同校验逻辑，落同一集合）
        return await addReviewHandler(db, pl)

      case 'addReview': {
        const result = await addReviewHandler(db, pl)
        // 兼容：addReviewHandler 返回 data.id（非 _id），管理端新列表项
        // 用 _id 作删除 key；补一个 _id 别名，保证"新增→立即删除"闭环可用。
        if (result && result.code === 0 && result.data && result.data.id && !result.data._id) {
          result.data._id = result.data.id
        }
        return result
      }

      case 'deleteReview': {
        const { reviewId } = pl
        if (!reviewId) return { code: -1, message: '缺少 reviewId' }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_reviews', targetId: reviewId, op: 'delete', destructive: true },
          async () => {
            await ensureCollection('sm_reviews')
            await db.collection('sm_reviews').doc(reviewId).remove()
            return { code: 0 }
          }
        )
      }

      case 'seedReviews':
        return await exports.seedReviewsHandler(db)

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
        // 【R-004 数据源】服务提交含客户表单信息，读取留痕
        await logSecurityEvent(db, {
          eventType: EVENT_TYPES.ADMIN_ACTION, severity: 'info',
          fn: 'admin-api', action, ip, ua, reqId,
          authResult: 'success', keyFp: keyFingerprint(adminKey),
          detail: { target: 'sm_submissions', op: 'read', destructive: false, count: (res.data || []).length },
        })
        return { code: 0, data: res.data }
      }

      case 'updateSubmissionStatus': {
        const { submissionId, status } = pl
        if (!submissionId) return { code: -1, message: '缺少 submissionId' }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_submissions', targetId: submissionId, op: 'update', destructive: false },
          async () => {
            await ensureCollection('sm_submissions')
            await db.collection('sm_submissions').doc(submissionId).update({ status: status || 'done', updatedAt: now() })
            return { code: 0 }
          }
        )
      }

      case 'deleteSubmission': {
        const { submissionId } = pl
        if (!submissionId) return { code: -1, message: '缺少 submissionId' }
        return await auditedWrite(
          { db, action, ip, ua, reqId, keyFp: keyFingerprint(adminKey) },
          { target: 'sm_submissions', targetId: submissionId, op: 'delete', destructive: true },
          async () => {
            await ensureCollection('sm_submissions')
            await db.collection('sm_submissions').doc(submissionId).remove()
            return { code: 0 }
          }
        )
      }

      default: {
        // 【P0-4 ⑤】未知 action 留痕（端点枚举检测数据源，R-008）
        await logSecurityEvent(db, {
          eventType: EVENT_TYPES.UNKNOWN_ACTION, severity: 'medium',
          fn: 'admin-api', action, ip, ua, reqId,
          authResult: 'success',
          detail: { reason: '未知操作' },
        })
        return { code: -1, message: '未知操作' }
      }
    }
  } catch (err) {
    console.error('[admin-api]', action, err)
    // 【P0-4】内部异常留痕
    await logSecurityEvent(db, {
      eventType: EVENT_TYPES.INTERNAL_ERROR, severity: 'medium',
      fn: 'admin-api', action, ip, ua, reqId,
      detail: { err: String(err && err.message).slice(0, 200) },
    })
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}
