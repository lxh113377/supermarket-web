// 工作流步骤块的取数工具（第三十七轮）：按 GitHub Actions 的 step 头切块，供"上传面 ⇄ 判据名字"对账复用。
// 只在此处放一份：判据侧（check-backup-liveness）与夹具侧都从这里取形状，避免两处各写一个正则。

/** step 头：`- name:` 或 `- uses:`（缩进不敏感，但必须是列表项本体）。 */
export const STEP_HEAD = /^[ \t]+-[ \t]+(name|uses):/

/** 取某个 step 的完整文本块：从自己的头行到下一个 step 头之前。 */
export function stepBlocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const heads = lines.map((l, i) => (STEP_HEAD.test(l) ? i : -1)).filter((i) => i >= 0)
  return heads.map((start, k) => lines.slice(start, k + 1 < heads.length ? heads[k + 1] : lines.length).join('\n'))
}

/** 其中真正"上传产物"的步骤块（uses: actions/upload-artifact@…）。 */
export function uploadStepBlocks(text) {
  return stepBlocks(text).filter((b) => /uses:\s*actions\/upload-artifact@/.test(b))
}
