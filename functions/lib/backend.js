// Cloudflare Pages Functions 后端核心（调度层）
// 对齐原 CloudBase 云函数 action 契约：POST { action, adminKey?, payload }
// 存储：D1 (env.DB)。数组/对象以 JSON 文本存储。
//
// 入口：functions/web.js（管理，需 ADMIN_KEY）、functions/pub.js（公开）
// 分层（2026-09-05 拆分，行为零改动）：
//   db.js                 D1 帮助函数/通用工具
//   security.js           限流（KV→D1）、IP、审计、图片/UGC 校验、鉴权、CORS
//   actions/products.js   商品/分类域
//   actions/orders.js     订单域
//   actions/reviews.js    评价域
//   actions/submissions.js 服务提交域
//   actions/ai.js         AI 建议与导购
//   backend.js            本文件：handleAdmin/handlePublic 路由 + 审计编排

import { checkRate, checkRateKV, getClientIp, sha256Fingerprint, logSecurityEvent,
  checkAuth, resolveRole, resolveCorsHeaders, PUBLIC_ACTIONS,
  RATE_LOGIN, RATE_PUBLIC_WRITE, RATE_AI } from './security.js'
import { getPublicProducts, getPublicCategories, getProducts, createProduct, updateProduct,
  deleteProduct, batchUpdateProducts, batchDeleteProducts } from './actions/products.js'
import { createOrder, deleteOrder, updateOrderStatus, recalculateOrders, getOrders, getOrderById } from './actions/orders.js'
import { getReviews, addReview, getAllReviews, deleteReview, seedReviews } from './actions/reviews.js'
import { createSubmission, getSubmissions, getSubmissionImages, updateSubmissionStatus, deleteSubmission } from './actions/submissions.js'
import { adminAiAdvice, pubAiChat } from './actions/ai.js'
import { getDashboardStats } from './actions/stats.js'
import { kvCacheGetJSON, kvCacheSet, invalidatePublicCatalog } from './cache.js'

// 管理端写操作（审计日志覆盖范围）
const ADMIN_WRITE_ACTIONS = new Set([
  'createProduct', 'updateProduct', 'deleteProduct',
  'deleteOrder', 'updateOrderStatus',
  'deleteReview', 'updateSubmissionStatus', 'deleteSubmission',
])

export async function handleAdmin(env, action, adminKey, payload = {}, request = null) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  const ip = getClientIp(request)
  // 登录限流必须在鉴权之前：无论密钥对错都计数，才能真正防暴力破解
  if (action === 'login') {
    const r = await checkRate(DB, env.RATE_KV, `rate:login:${ip}`, RATE_LOGIN.windowMs, RATE_LOGIN.max)
    if (r) return r
  }
  const authErr = checkAuth(action, adminKey, env)
  if (authErr) {
    // 认证失败审计（不落原始密钥，仅指纹）
    if (!PUBLIC_ACTIONS.has(action)) {
      await logSecurityEvent(DB, { ip, action, result: 'auth_failed', keyFingerprint: await sha256Fingerprint(adminKey) })
    }
    return authErr
  }
  // 权限细分：只读密钥禁止管理写操作
  const role = resolveRole(adminKey, env)
  if (role === 'readonly' && ADMIN_WRITE_ACTIONS.has(action)) {
    return { code: -1, message: '只读账号不能执行该操作' }
  }

  let result
  try {
    switch (action) {
      case 'login': {
        result = { code: 0, role }
        break
      }
      case 'verifyKey':
        result = { code: 0, role }
        break
      case 'getProducts': result = await getProducts(DB); break
      case 'createProduct': result = await createProduct(DB, payload); break
      case 'updateProduct': result = await updateProduct(DB, payload); break
      case 'deleteProduct': result = await deleteProduct(DB, payload); break
      // M1：商品/分类写操作后失效公共目录 KV 缓存（顾客端最长 60s 拿到旧数据 → 即时失败）
      case 'batchUpdateProducts': result = await batchUpdateProducts(DB, payload); break
      case 'batchDeleteProducts': result = await batchDeleteProducts(DB, payload); break
      case 'deleteOrder': result = await deleteOrder(DB, payload); break
      case 'updateOrderStatus': result = await updateOrderStatus(DB, payload); break
      case 'createOrder': result = await createOrder(DB, payload); break
      case 'recalculateOrders': result = await recalculateOrders(DB); break
      case 'getOrders': result = await getOrders(DB, payload); break
      case 'getOrder': result = { code: 0, data: await getOrderById(DB, payload.orderId) }; break
      case 'getPublicProducts': {
        // M1：公共商品走 KV 缓存（60s TTL）；命中直接返回，未命中查库后回填
        const cached = await kvCacheGetJSON(env, 'cache:public:products')
        if (cached) { result = cached; break }
        result = await getPublicProducts(DB)
        if (result.code === 0) await kvCacheSet(env, 'cache:public:products', result, 60)
        break
      }
      case 'getPublicCategories': {
        const cached = await kvCacheGetJSON(env, 'cache:public:categories')
        if (cached) { result = cached; break }
        result = await getPublicCategories(DB)
        if (result.code === 0) await kvCacheSet(env, 'cache:public:categories', result, 60)
        break
      }
      case 'getAllReviews': result = await getAllReviews(DB); break
      case 'getReviews': result = await getReviews(DB, payload); break
      case 'addPublicReview': result = await addReview(DB, payload); break
      case 'addReview': {
        result = await addReview(DB, payload)
        if (result.code === 0 && result.data && result.data.id && !result.data._id) result.data._id = result.data.id
        break
      }
      case 'deleteReview': result = await deleteReview(DB, payload); break
      case 'seedReviews': result = await seedReviews(DB); break
      case 'createSubmission': result = await createSubmission(DB, payload); break
      case 'getSubmissions': result = await getSubmissions(DB); break
      case 'getSubmissionImages': result = await getSubmissionImages(DB, payload); break
      case 'updateSubmissionStatus': result = await updateSubmissionStatus(DB, payload); break
      case 'deleteSubmission': result = await deleteSubmission(DB, payload); break
      case 'aiAdvice': {
        // M2：AI 建议 60s KV 缓存（近 30 天快照确定性高；命中免去全量订单/评价/商品查询与 Dify 调用）
        const cached = await kvCacheGetJSON(env, 'cache:ai:advice')
        if (cached) { result = cached; break }
        result = await adminAiAdvice(env, DB)
        if (result.code === 0) await kvCacheSet(env, 'cache:ai:advice', result, 60)
        break
      }
      case 'getDashboardStats': result = await getDashboardStats(DB, payload); break
      default: result = { code: -1, message: '未知操作' }
    }
  } catch (e) {
    console.error('[admin]', action, e)
    result = { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
  // M1：商品/分类写操作成功后失效公共目录 KV 缓存（顾客端立即看到新数据）
  if (result.code === 0 && ['createProduct', 'updateProduct', 'deleteProduct', 'batchUpdateProducts', 'batchDeleteProducts'].includes(action)) {
    await invalidatePublicCatalog(env)
  }
  // 管理写操作 / 登录审计
  if (action === 'login' || ADMIN_WRITE_ACTIONS.has(action)) {
    await logSecurityEvent(DB, {
      ip, action, result: result.code === 0 ? 'ok' : 'fail', keyFingerprint: await sha256Fingerprint(adminKey),
    })
  }
  return result
}

export async function handlePublic(env, action, payload = {}, request = null) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  if (!PUBLIC_ACTIONS.has(action)) return { code: -1, message: '未知操作（public 仅支持公开接口）' }
  const ip = getClientIp(request)
  if (['createOrder', 'createSubmission', 'addPublicReview'].includes(action)) {
    const r = await checkRate(DB, env.RATE_KV, `rate:write:${ip}`, RATE_PUBLIC_WRITE.windowMs, RATE_PUBLIC_WRITE.max)
    if (r) return r
  }
  try {
    switch (action) {
      case 'getPublicProducts': {
        // M1：与 handleAdmin 同源缓存键，顾客端 /pub 与后台 /web 共享同一 KV 缓存
        const cached = await kvCacheGetJSON(env, 'cache:public:products')
        if (cached) return cached
        const result = await getPublicProducts(DB)
        if (result.code === 0) await kvCacheSet(env, 'cache:public:products', result, 60)
        return result
      }
      case 'getPublicCategories': {
        const cached = await kvCacheGetJSON(env, 'cache:public:categories')
        if (cached) return cached
        const result = await getPublicCategories(DB)
        if (result.code === 0) await kvCacheSet(env, 'cache:public:categories', result, 60)
        return result
      }
      case 'createOrder': return await createOrder(DB, payload)
      case 'getReviews': return await getReviews(DB, payload)
      case 'addPublicReview': return await addReview(DB, payload)
      case 'createSubmission': return await createSubmission(DB, payload)
      case 'aiChat': {
        // AI 导购限流：20 次/60s/IP（复用 KV→D1 降级链）
        const r = await checkRate(DB, env.RATE_KV, `rate:ai:${ip}`, RATE_AI.windowMs, RATE_AI.max)
        if (r) return r
        return await pubAiChat(env, DB, payload, ip)
      }
      default: return { code: -1, message: '未知操作' }
    }
  } catch (e) {
    console.error('[pub]', action, e)
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}

// 兼容导出：web.js/pub.js 用 resolveCorsHeaders；测试用 checkRate/checkRateKV/batch*
export { resolveCorsHeaders, checkRate, checkRateKV, batchUpdateProducts, batchDeleteProducts }
