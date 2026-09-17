// AI 调用留痕（双向迭代 R4，2026-09-18）
// 借鉴门店项目 src/ai_trace.py：每次 AI 调用落一行，产出「可用率 / 平均延迟 / 回退次数」。
// 价值：① 线上到底有没有真的在调大模型，从"靠日志猜"变成"可举证"；
//      ② Dify 生产接入后，prompt/模型变更的效果可被观测；
//      ③ 规则版与在线版的真实占比一目了然（避免"以为在用 AI，其实一直在跑规则版"）。
//
// 铁律：留痕失败绝不影响主流程——可观测性优先级低于 AI 能力降级链，任何异常都只记日志。
import { qAll, qRun } from './db.js'
import { sha256Fingerprint } from './security.js'

export const AI_SOURCES = ['rule', 'dify', 'dify-error']

// 指纹计算失败（如运行环境无 crypto.subtle）不得影响留痕，退化为空指纹
async function fingerprintSafe(raw) {
  try {
    return raw ? await sha256Fingerprint(raw) : ''
  } catch {
    return ''
  }
}

export async function traceAiCall(DB, {
  scene,
  source,
  ok,
  fallback = false,
  latencyMs = 0,
  tokens = null,
  keyFp = null,
  keyRaw = null, // 传原始密钥时，本函数内部脱敏为指纹后落库（绝不落明文）
}) {
  if (!DB) return null
  try {
    if (keyFp == null && keyRaw) keyFp = await fingerprintSafe(keyRaw)
    const ts = new Date().toISOString()
    await qRun(
      DB,
      `INSERT INTO ai_calls (ts, scene, source, ok, fallback, latencyMs, tokens, keyFp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ts,
        String(scene || ''),
        String(source || ''),
        ok ? 1 : 0,
        fallback ? 1 : 0,
        Math.max(0, Math.round(Number(latencyMs) || 0)),
        tokens == null ? null : Number(tokens),
        keyFp == null ? '' : String(keyFp),
      ],
    )
    return ts
  } catch (e) {
    console.error('[ai_trace] 写入失败（不影响主流程）', e)
    return null
  }
}

// 近 N 条留痕 + 三个可运维数字：可用率 / 平均延迟 / 回退次数
export async function aiCallStats(DB, limit = 20) {
  const empty = { total: 0, okRate: null, avgLatencyMs: null, fallbackCount: 0, recent: [] }
  if (!DB) return empty
  try {
    const rows = await qAll(DB, `SELECT * FROM ai_calls ORDER BY ts DESC LIMIT ?`, [limit])
    const agg = await qAll(
      DB,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS okCount,
              SUM(CASE WHEN fallback = 1 THEN 1 ELSE 0 END) AS fallbackCount,
              AVG(latencyMs) AS avgLatency
       FROM ai_calls`,
    )
    const a = agg[0] || {}
    const total = Number(a.total) || 0
    return {
      total,
      okRate: total ? Number(a.okCount || 0) / total : null,
      avgLatencyMs: total && a.avgLatency != null ? Math.round(Number(a.avgLatency)) : null,
      fallbackCount: Number(a.fallbackCount) || 0,
      recent: rows,
    }
  } catch (e) {
    console.error('[ai_trace] 统计失败', e)
    return empty
  }
}
