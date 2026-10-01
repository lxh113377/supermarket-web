// AI 域 handlers（从 backend.js 拆出，逻辑零改动）
// ── AI 经营助手（F38 铁律：dify-error 一律降级展示，绝不把错误串当建议渲染）──
// 2026-09-18 双向迭代 R4：两个场景的全部分支（rule / dify / dify-error）统一留痕，
// 留痕失败不影响返回（见 ai_trace.js）。

import { logError } from '../logger.js'
import { qAll, jparse } from '../db.js'
import { fail } from '../errors.js'
import {
  callDifyChat,
  callDifyCompletion,
  enabled,
  ruleAssistantReply,
  ruleAdvice,
  buildAdviceInput,
  sanitize,
  DIFY_UNAVAILABLE_TEXT,
} from '../dify.js'
import { traceAiCall } from '../ai_trace.js'
import { getProducts } from './products.js'
import { getAllReviews } from './reviews.js'

// 管理端：近 30 天经营建议（/web aiAdvice，只读，只读密钥可用）
export async function adminAiAdvice(env, DB) {
  const scene = 'aiAdvice'
  try {
    // 一次全量查询（getOrders 默认 50/100 条会截断近 30 天窗口；社区超市量级 LIMIT 2000 足够）
    // ⚠️ 投影只准出现**下游真引用到的列**（P12 互锁：check-pii-inventory.mjs 拿本文件 + dify.js 的
    // `o.<列>` 引用反推允许集，多一列即判红）。原投影带 `roomNumber / wechat / remark / _id / status /
    // updatedAt`，六个字段 buildAdviceInput 与 ruleAdvice 一个都没用上 —— 白读六列不是"反正没出境"
    // 就无害：它是把个人数据多搬进一次冷启动 isolate 的内存与日志面，也是"哪天有人顺手 JSON.stringify
    // 这份快照"就出境的引信。对账夹具见 tests/aiContract.test.js「出境面收敛」。
    const orderRows = await qAll(DB,
      `SELECT items, totalAmount, createdAt
       FROM orders ORDER BY createdAt DESC LIMIT 2000`)
    const orders = orderRows.map((r) => ({ ...r, items: jparse(r.items, []) }))
    const cutoff = Date.now() - 30 * 86400000
    const orders30 = orders.filter((o) => {
      const t = new Date(o.createdAt).getTime()
      return !Number.isNaN(t) && t >= cutoff
    })
    const revRes = await getAllReviews(DB)
    const prodRes = await getProducts(DB)
    const reviews = revRes.data || []
    const products = prodRes.data || []
    if (!enabled(env)) {
      // 规则版同样留痕——「AI 到底有没有在用」正是靠这条记录自证
      await traceAiCall(DB, { scene, source: 'rule', ok: true, fallback: true, latencyMs: 0 })
      return { code: 0, data: { source: 'rule', content: ruleAdvice({ orders30, reviews }) } }
    }
    const input = buildAdviceInput(orders30, reviews, products)
    const prompt = `你是校园超市经营助手。以下是近 30 天经营快照：${JSON.stringify(input)}。请给店主一份简洁的经营建议（备货/定价/服务三个维度，3-4 条）。`
    const t0 = Date.now()
    const r = await callDifyCompletion(env, prompt, 'admin')
    await traceAiCall(DB, {
      scene,
      source: r.source,
      ok: r.source === 'dify',
      fallback: r.source !== 'dify',
      latencyMs: Date.now() - t0,
      keyRaw: env.DIFY_ADVICE_APP_KEY || '',
    })
    return { code: 0, data: r }
  } catch (e) {
    logError('aiAdvice', 'AI 建议生成失败', { err: e })
    await traceAiCall(DB, { scene, source: 'dify-error', ok: false, fallback: true, latencyMs: 0 })
    return { code: 0, data: { source: 'dify-error', content: DIFY_UNAVAILABLE_TEXT } }
  }
}

// 顾客端：AI 导购对话（/pub aiChat；限流在 handlePublic 路由层）
export async function pubAiChat(env, DB, payload, ip) {
  const scene = 'aiChat'
  const question = sanitize(payload?.question, 200)
  const conversationId = sanitize(payload?.conversationId, 100) || null
  if (!question) return fail('invalid_params', '问题不能为空')
  try {
    if (!enabled(env)) {
      await traceAiCall(DB, { scene, source: 'rule', ok: true, fallback: true, latencyMs: 0 })
      return { code: 0, data: { source: 'rule', content: ruleAssistantReply(question), conversationId } }
    }
    const t0 = Date.now()
    const r = await callDifyChat(env, question, `pub-${String(ip).slice(0, 40)}`, conversationId)
    await traceAiCall(DB, {
      scene,
      source: r.source,
      ok: r.source === 'dify',
      fallback: r.source !== 'dify',
      latencyMs: Date.now() - t0,
      keyRaw: env.DIFY_CHAT_APP_KEY || '',
    })
    return { code: 0, data: r }
  } catch (e) {
    logError('aiChat', 'AI 对话失败', { err: e })
    await traceAiCall(DB, { scene, source: 'dify-error', ok: false, fallback: true, latencyMs: 0 })
    return { code: 0, data: { source: 'dify-error', content: DIFY_UNAVAILABLE_TEXT, conversationId } }
  }
}
