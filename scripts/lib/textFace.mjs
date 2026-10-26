/**
 * 与 verify:eol 同源的「文本面」取数器（第 91 轮）。
 *
 * 为什么不各列一张扩展名表：staged-syntax 的末行换行腿第一版自带 15 项 TEXT_EXTS，
 * 实测与 .gitattributes 的文本面差 **15 类 / 45 件**（.sql 28 件、.jsonl 3 件、两个无扩展名的
 * git hooks 脚本、.editorconfig 等全在表外）。硬编码表会随仓库演化**静默漏面** —— 正是本仓
 * 反复抓的「只有措辞在守的账」。verify:eol 头注早就给了正确范式：**用 git 的结论而不是自己
 * 读 .gitattributes 猜**（属性表写了但没生效、被 info/attributes 覆盖、模式写错，只有 git 知道）。
 * 两条判据因此共用同一个分母，不会再各说各话。
 */
import { spawnSync } from 'node:child_process'

/**
 * @returns 文本件路径集合；git 不可用 ⇒ null（调用方必须走 UNVERIFIED，
 *          不许把「没取到」读成「没有文本件」—— 本仓零分母那一族）
 */
export function textFaceOfIndex(cwd = process.cwd()) {
  const r = spawnSync('git', ['ls-files', '--eol', '-z'], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) return null
  const text = new Set()
  for (const rec of String(r.stdout || '').split('\0')) {
    if (!rec) continue
    const tab = rec.indexOf('\t')
    if (tab === -1) continue
    const meta = rec.slice(0, tab)
    const p = rec.slice(tab + 1)
    // attr:binary / attr:set ⇒ .gitattributes 显式声明不判；i/-text ⇒ git 自己判成二进制
    if (/attr:(binary|set)\b/.test(meta)) continue
    if (/i\/-text\b/.test(meta)) continue
    text.add(p)
  }
  return text
}
