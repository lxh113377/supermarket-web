/**
 * 「登记项的理由」质量判据 —— 全仓唯一实现（第三十五轮）。
 *
 * 消费者（同一事实只许一处判，见 [[one-fact-one-judge]]）：
 *   - scripts/api-response-contract.mjs 的 `RESPONSE_GAPS`（未录到成功形状的 action）
 *   - scripts/check-registry-sync.mjs 的 `BASELINE_EXCEPTIONS`（基线里对不上分发面的键）
 *
 * 立它的实证（第二十九轮一手）：`RESPONSE_GAPS` 里我写过两条理由 ——
 *   "要带 base64 图片才能走通校验链" / "需要提交带图片才有对象取"
 * 两条都被一条 payload 证伪：`images` 在 `createSubmission` 里**本就是可选**。
 * 判据当时只能保证"没登记就红"，保证不了"登记的理由是真的" ⇒ 自由文本的理由等于没有理由。
 *
 * 本轮把它机器化：**理由必须可证伪** = 含至少一个数字（实测值）或一段反引号包住的命令（可复跑）。
 * 这不是文笔要求 —— 带数字的句子下一轮可以被重跑证伪，纯形容词的句子永远证伪不了。
 */
export const REASON_MIN_CHARS = 20

/** @returns {string[]} 缺陷列表（空=合格）。name 只用于点名，不参与判定。 */
export function reasonDefects(name, reason, { minChars = REASON_MIN_CHARS } = {}) {
  const out = []
  const s = typeof reason === 'string' ? reason.trim() : ''
  if (!s) { out.push(`${name}：理由缺失或全空白`); return out }
  if (s.length < minChars) out.push(`${name}：理由仅 ${s.length} 字（须 ≥${minChars}），短到无法承载一个事实`)
  if (/^待[定确核]|TODO|TBD|待定|以后再/.test(s)) out.push(`${name}：理由是占位词（${s.slice(0, 12)}…）`)
  const hasNumber = /\d/.test(s)
  const hasCommand = /`[^`]+`/.test(s)
  if (!hasNumber && !hasCommand) {
    out.push(`${name}：理由既无实测数字也无可复跑命令 ⇒ 不可证伪（原文：${s.slice(0, 40)}…）`)
  }
  return out
}
