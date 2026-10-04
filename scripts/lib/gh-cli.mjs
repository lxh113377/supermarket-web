// 共享取数件：**定位并调用一个真能跑的 GitHub CLI**（第六十七轮立）
//
// 立它的读数是两次同源事故，都发生在同一个形态上 ——「按名字 spawn `gh`」，而本机 PATH 首位
// `C:/Users/37533/.local/bin/gh` 是一个 **0 字节、无扩展名的残件**：
//   · PowerShell 把它当"文档"，报 `Cannot run a document in the middle of a pipeline` 并**零输出**；
//   · Node 的 spawnSync 同样跑不起来，而它的失败也是零输出的那种（`r.error` 里只有一句 spawn 失败）。
// 后果不是"少一条数据"，而是**整轮对标数据降级**：第六十五、六十六轮报告里那些
// 「本机 gh 取不到 / 本机 curl 超时 ⇒ 这一面不可得」的读数，成因是取数器挑错了通道，
// 却被复述成了「这台机器量不到」。
//
// 所以这里只做三件事，且都必须是"验过的"而不是"试过的"：
//   1) `findGh()` 逐个候选验「是文件 + 非 0 字节 + 落在可执行扩展名上」，再按**绝对路径** spawn；
//      POSIX 上额外接受带 shebang 的无扩展名文件（那正是测试夹具能造出来的形态），Windows 上不接受。
//   2) `runGh()` 每次调用都带 timeout —— **无上限的取数器 = 静默挂死**，而取数器恰恰是
//      "判据自己量不到时必须 fail-closed" 这条纪律的第一个被执行者。
//   3) 返回值形状与各调用方原有的形状保持一致，调用方不需要改判读逻辑。
//
// ⚠️ 本件**刻意不自己判绿**：它只负责"把 gh 叫起来"，取到的是不是绿由调用方的判据判。
// 若哪天它开始顺手把失败读成空数组，就等于给全仓的取数面装了一个统一的静默出口。
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const EXTS = /\.(exe|cmd|bat)$/i

/** @returns {string|null} 可执行的 gh 绝对路径；找不到返回 null（**不等于**"没有数据"）。 */
export function findGh({ extraDirs = [] } = {}) {
  const dirs = [...extraDirs, ...String(process.env.PATH || '').split(/[;:]/)].filter(Boolean)
  const cands = []
  for (const d of dirs) cands.push(join(d, 'gh.exe'), join(d, 'gh.cmd'), join(d, 'gh.bat'))
  cands.push('C:/Program Files/GitHub CLI/gh.exe')
  const seen = new Set()
  for (const c of cands) {
    if (seen.has(c)) continue
    seen.add(c)
    try {
      const st = statSync(c)
      if (!st.isFile() || st.size === 0) continue // 0 字节残件：存在，但跑不了
      if (EXTS.test(c) || (process.platform !== 'win32' && !/\.[a-z0-9]+$/i.test(c))) return c
    } catch { /* 候选不存在，继续找 */ }
  }
  return null
}

let cached
/**
 * @returns {{exe: string|null, status: number|null, stdout: string, stderr: string, error: Error|null}}
 *   `exe === null` 表示**机器上找不到可执行的 gh**；这与"gh 跑了但没数据"是两件事，调用方必须分开处理。
 */
export function runGh(args, { timeoutMs = 20000, input } = {}) {
  if (cached === undefined) cached = findGh()
  if (!cached) return { exe: null, status: null, stdout: '', stderr: '', error: null }
  const r = spawnSync(cached, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, input })
  return { exe: cached, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null }
}

/** 供自测/夹具用：清掉进程内缓存（换 PATH 后必须调，否则会拿旧的判定）。 */
export function resetGhCache() { cached = undefined }
