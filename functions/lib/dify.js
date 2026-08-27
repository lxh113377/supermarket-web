// Dify 私有化 AI 集成（Cloudflare Pages Functions 版）
// 对齐 iCAN dify_client.py 设计（防腐层 F7 / 单一真相源 F16 / 降级铁律 F38）：
//   1. 所有对外 Dify 调用异常统一由 failMarker 收口——服务端记录，
//      对上层只返回 '[DIFY_ERROR]…' 脱敏标记串，绝不把堆栈/内网信息/Key 透传到前端；
//   2. 上层用 isDifyError() 判断失败，失败一律不得当作有效 AI 结果；
//   3. source 三态：'rule'（规则版，未配置 Dify）/ 'dify'（AI 正常）/ 'dify-error'（AI 不可用，前端必须降级展示）；
//   4. enabled 判断只在本模块内做（F16），路由层不再重复判断；
//   5. 熔断器：CF isolate 进程内内存态（多 isolate 各自独立计数，分布局限见 allow() 注释）。
//
// 客户端提示（rule 版同源于前端 assistantFaq.ts，改动需两侧同步）：
//   - DIFY_BASE_URL / DIFY_CHAT_APP_KEY（顾客端导购 Chat App）/ DIFY_ADVICE_APP_KEY（管理端建议 Completion App）
//   - 未配置 → 全站自动规则版，功能不缺失

// ── 统一失败标记（F7/F38）──
export const DIFY_ERROR_PREFIX = '[DIFY_ERROR]'
export const DIFY_UNAVAILABLE_TEXT = 'AI 服务暂不可用，已切换为演示模式，请稍后重试。'

export function isDifyError(text) {
  if (typeof text !== 'string') return false
  return text.trimStart().startsWith(DIFY_ERROR_PREFIX)
}

// 失败出口：服务端记日志（含场景，方便排障），对上层只返回脱敏标记串
export function failMarker(scene) {
  console.error(`[dify] 调用失败 scene=${scene}`)
  return `${DIFY_ERROR_PREFIX} ${DIFY_UNAVAILABLE_TEXT}`
}

// 入参消毒：trim + 长度钳制（防滥用；0 长度返回 ''）
export function sanitize(text, maxLen = 200) {
  if (typeof text !== 'string') return ''
  const t = text.trim()
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

// ── 熔断器（D3 轻量版）──
export class CircuitBreaker {
  constructor(threshold = 3, cooldownMs = 30000) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.failures = 0
    this.openedAt = 0
  }

  allow() {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.openedAt < this.cooldownMs) return false
      this.failures = 0 // 冷却结束，半开试探
    }
    return true
  }

  onSuccess() {
    this.failures = 0
    this.openedAt = 0
  }

  onFailure() {
    this.failures += 1
    if (this.failures >= this.threshold) this.openedAt = Date.now()
  }
}

const breaker = new CircuitBreaker()

// ── 单一真相源（F16）：是否启用 Dify ──
export function enabled(env) {
  return Boolean(env.DIFY_CHAT_APP_KEY || env.DIFY_ADVICE_APP_KEY)
}

const DIFY_TIMEOUT_MS = 20000

// Dify Chat App：多轮对话（顾客端导购）
// 返回 { source, content, conversationId }；未启用返回 { source: 'rule', content: '' }
export async function callDifyChat(env, query, user, conversationId = null) {
  if (!enabled(env)) {
    return { source: 'rule', content: '', conversationId }
  }
  if (!env.DIFY_BASE_URL || !env.DIFY_CHAT_APP_KEY) {
    return { source: 'dify-error', content: `${DIFY_ERROR_PREFIX} 未配置 DIFY_CHAT_APP_KEY`, conversationId }
  }
  if (!breaker.allow()) {
    return { source: 'dify-error', content: failMarker('breaker-chat'), conversationId }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DIFY_TIMEOUT_MS)
  try {
    const resp = await fetch(`${env.DIFY_BASE_URL.replace(/\/$/, '')}/v1/chat-messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DIFY_CHAT_APP_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: 'blocking',
        conversation_id: conversationId || '',
        user,
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      breaker.onFailure()
      return { source: 'dify-error', content: failMarker(`chat-http-${resp.status}`), conversationId }
    }
    const data = await resp.json()
    breaker.onSuccess()
    return { source: 'dify', content: data.answer || '', conversationId: data.conversation_id || conversationId }
  } catch (err) {
    breaker.onFailure()
    console.error(`[dify] chat scene=chat-${err?.name || 'err'}`, err)
    return { source: 'dify-error', content: failMarker('chat-exception'), conversationId }
  } finally {
    clearTimeout(timer)
  }
}

// Dify Completion App：单次生成（管理端经营建议）
export async function callDifyCompletion(env, prompt, user) {
  if (!enabled(env)) {
    return { source: 'rule', content: '' }
  }
  if (!env.DIFY_BASE_URL || !env.DIFY_ADVICE_APP_KEY) {
    return { source: 'dify-error', content: `${DIFY_ERROR_PREFIX} 未配置 DIFY_ADVICE_APP_KEY` }
  }
  if (!breaker.allow()) {
    return { source: 'dify-error', content: failMarker('breaker-completion') }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DIFY_TIMEOUT_MS)
  try {
    const resp = await fetch(`${env.DIFY_BASE_URL.replace(/\/$/, '')}/v1/completion-messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DIFY_ADVICE_APP_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: { query: prompt }, response_mode: 'blocking', user }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      breaker.onFailure()
      return { source: 'dify-error', content: failMarker(`completion-http-${resp.status}`) }
    }
    const data = await resp.json()
    breaker.onSuccess()
    return { source: 'dify', content: data.answer || '' }
  } catch (err) {
    breaker.onFailure()
    console.error(`[dify] completion scene=completion-${err?.name || 'err'}`, err)
    return { source: 'dify-error', content: failMarker('completion-exception') }
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────
// 规则版知识（无 Dify 时的回退；与前端 src/data/assistantFaq.ts 同源，改动需两侧同步）
const RULE_HOURS = '08:00 - 22:00'
const RULE_FAQ = [
  { match: ['营业', '开门', '多久', '时间', '关门'], answer: `本店营业时间 ${RULE_HOURS}，周末照常营业。` },
  { match: ['配送', '送到', '多久', '送货'], answer: '下单后我们会尽快安排配送，一般在当轮配送时段内送达宿舍楼下，请保持手机畅通接收取餐通知。' },
  { match: ['支付', '付款', '微信', '支付宝', '怎么付'], answer: '支持微信支付与支付宝，下单页选择支付方式，按提示扫码或确认支付即可；付款后订单自动进入配送队列。' },
  { match: ['退', '换', '错', '少', '漏'], answer: '收到商品如有少件/错件/质量问题，可在订单页提交售后或联系客服，我们会尽快处理退换。' },
]

// 顾客端规则版导购：FAQ 命中 + 关键词 → 热销推荐 + 兜底引导
export function ruleAssistantReply(question, products = []) {
  const q = String(question || '')
  for (const item of RULE_FAQ) {
    if (item.match.some((kw) => q.includes(kw))) {
      return [item.answer, suggest(products)].filter(Boolean).join('\n\n')
    }
  }
  return ['可以咨询商品、营业时间（' + RULE_HOURS + '）、配送与支付等问题。', suggest(products)].filter(Boolean).join('\n\n')
}

function suggest(products = []) {
  // 热销：价格字段兜底按第一个；这里仅做轻量推荐，不依赖订单数据
  const picks = products.slice(0, 3).map((p) => p.name).join('、')
  return picks ? `当前热销：${picks}，也可以直接去商品页选购～` : ''
}

// ─────────────────────────────────────────────────────────────
// 管理端规则版经营建议（基于订单/评价的真实统计）
export function ruleAdvice({ orders30 = [], reviews = [] } = {}) {
  // 近 30 天营收与订单
  const revenue30 = orders30.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
  const order30 = orders30.length
  // 热销 TOP3（按订单内商品项数近似）
  const itemQty = {}
  for (const o of orders30) {
    for (const it of o.items || []) {
      const key = it.name + (it.spec ? `(${it.spec})` : '')
      itemQty[key] = (itemQty[key] || 0) + (Number(it.quantity) || 0)
    }
  }
  const top3 = Object.entries(itemQty).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)
  // 低分评价（≤2 分）提示
  const low = reviews.filter((r) => Number(r.rating) <= 2).length

  if (order30 === 0) {
    return '暂无近 30 天订单数据，待顾客下单后生成经营建议。'
  }
  const lines = []
  lines.push(`📊 近 30 天：营收 ¥${Math.round(revenue30)}，共 ${order30} 单。`)
  if (top3.length) lines.push(`1. 优先备货热销：${top3.join('、')}，按平日 1.2 倍预备。`)
  lines.push('2. 易损鲜蔬/乳品按需采购，避免隔夜损耗。')
  if (low > 0) lines.push(`3. 近 30 天有 ${low} 条低分评价，建议复盘对应商品与服务话术。`)
  lines.push('配置 Dify 后可生成更精细的备货/定价建议。')
  return lines.join('\n')
}

// 汇总近 30 天经营快照（喂给 Dify Completion 的结构化输入）
export function buildAdviceInput(orders30 = [], reviews = [], products = []) {
  const itemQty = {}
  let revenue30 = 0
  for (const o of orders30) {
    revenue30 += Number(o.totalAmount) || 0
    for (const it of o.items || []) {
      const key = it.name + (it.spec ? `(${it.spec})` : '')
      const q = Number(it.quantity) || 0
      itemQty[key] = (itemQty[key] || 0) + q
    }
  }
  const top = Object.entries(itemQty)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
  const rated = reviews.filter((r) => Number(r.rating) > 0)
  const avgRating = rated.length ? (rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length).toFixed(1) : null
  return {
    days: 30,
    revenue: Math.round(revenue30),
    orders: orders30.length,
    topProducts: top,
    avgRating,
    lowRatingCount: reviews.filter((r) => Number(r.rating) <= 2).length,
    productCount: products.length,
  }
}