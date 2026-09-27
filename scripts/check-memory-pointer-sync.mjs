#!/usr/bin/env node
/**
 * memory-pointer-sync —— 外层"工作区级记忆指针"是否还跟着轮次走（第三十六轮）。
 *
 * 一手动因（本轮 Step 0 实测，不是猜）：`超市/memory/07-next-steps.md` 里有一串
 * `## <日期> — 对标第N轮（工作区级指针）` 的追加约定，**末次追加止于第二十九轮**，
 * 之后 R30~R34 共 5 轮静默断更，而且没有任何东西守着它（内层 4KB 判据的作用面不含该文件，
 * `handoff.py volume` 又按 shell_max=40,960B 判它 ⇒ 两把尺相差 10 倍，更松的那把量着更旧的那份）。
 *
 * 结论：**约定没有判据 = 约定会在某一轮无声失效**。本判据把它变成会红的东西。
 * 三态（同 check-branch-protection 的口径，绝不把"看不见"记成"通过"）：
 *   PASS        外层最新轮次 == 内层最新轮次（指针跟上了）
 *   FAIL        落后 / 超前 / 两侧都取不到轮次号（取数面坏了）
 *   UNVERIFIED  外层目录不在（CI 只检出代码仓 ⇒ 这是"未观测"，不是"已核对"）
 *
 * 用法：node scripts/check-memory-pointer-sync.mjs [--json]
 * 退出码：0=PASS 或 UNVERIFIED（advisory 不阻断）/ 1=判出漂移 / 2=内层取数失败
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 外层工作区记忆目录：在代码仓的**同级**（工作区根 `超市web/` 下），不在代码仓里。
 * 首版把这里写成 `../../超市/memory` ⇒ 解析到工作区之外 ⇒ existsSync 恒 false，
 * 判据一句话没说就走了 UNVERIFIED 分支，输出看着完全合理（"CI 只检出本仓"）。
 * 教训：一条会返回"未观测"的判据，必须先证明它在**能观测到的环境里观测到了**。
 */
export const OUTER_MEMORY = join(root, '..', '超市', 'memory')
const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** "第三十五轮" → 35；"第三十~三十五轮" → [30, 35]（R35 那次补齐就是区间写法）。
 *  解析不了返回空数组 —— **不得**返回 0，那会把"读不懂"伪装成"第 0 轮"。 */
export function roundsOf(text) {
  const out = []
  const re = /对标第([零一二三四五六七八九十百]{1,6}(?:\s*[~～\-、]\s*[零一二三四五六七八九十百]{1,6})*)轮/g
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(/[~～\-、]/)) {
      const r = cnNum(part.trim())
      if (r !== null) out.push(r)
    }
  }
  return out
}

/** 单个中文数词（支持到 九十九）；解析不了返回 null。 */
export function cnNum(s) {
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const ten = s.indexOf('十')
  if (ten >= 0) {
    const hi = ten === 0 ? 1 : CN[s[ten - 1]]
    const lo = ten === s.length - 1 ? 0 : CN[s[ten + 1]]
    if (hi === undefined || lo === undefined) return null
    return hi * 10 + lo
  }
  return CN[s] !== undefined && s.length === 1 ? CN[s] : null
}

/** 一份 07 系文件里最新的轮次号（多份取最大值）。 */
export function latestRound(dir) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => /^07-next-steps(\.part\d+)?\.md$/.test(f))
  let best = null
  const seen = []
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')
    for (const line of text.split('\n')) {
      if (!line.startsWith('## ')) continue
      for (const r of roundsOf(line)) { seen.push(r); if (best === null || r > best) best = r }
    }
  }
  return best === null ? { round: null, seen } : { round: best, seen }
}

export function evaluate({ inner, outer, outerPath = OUTER_MEMORY }) {
  const rows = []
  const push = (id, state, label, detail) => rows.push({ id, state, ok: state !== 'FAIL', label, detail })
  if (!inner) {
    push('P1', 'FAIL', 'P1 内层最新轮次取到', '内层 07 主卷取不到任何"对标第N轮"标题 ⇒ 取数面坏了，不判通过')
    return rows
  }
  if (outer === null) {
    push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮（标题命中 ${inner.seen.length} 处）`)
    push('P2', 'UNVERIFIED', 'P2 外层工作区指针是否跟上内层轮次',
      `外层目录不存在（${outerPath} 在代码仓之外，CI 只检出本仓）⇒ 这是未观测，不是已核对`)
    return rows
  }
  if (!outer) {
    push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮`)
    push('P2', 'FAIL', 'P2 外层工作区指针是否跟上内层轮次',
      '外层 07 系文件里取不到任何"对标第N轮"标题 ⇒ 指针序列被清空或改名，无人知晓就是这类失效的开端')
    return rows
  }
  const gap = inner.round - outer.round
  push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮（标题命中 ${inner.seen.length} 处）`)
  push('P2', gap === 0 ? 'PASS' : 'FAIL', 'P2 外层工作区指针是否跟上内层轮次',
    gap === 0
      ? `外层最新 = 第 ${outer.round} 轮 == 内层 ⇒ 指针在跟（断更过一次的那 5 轮已补齐）`
      : gap > 0
        ? `外层停在第 ${outer.round} 轮、内层已到第 ${inner.round} 轮 ⇒ 断更 ${gap} 轮：要么补一条指针，要么把"外层不再逐轮追加"写进外层文件头并改本判据口径`
        : `外层第 ${outer.round} 轮 超前内层第 ${inner.round} 轮 ⇒ 两侧轮次取数有一侧不对，先归因再改判据`)
  return rows
}

export function main({ dir = root, json = false, outerDir = OUTER_MEMORY } = {}) {
  const innerDir = join(dir, 'memory')
  if (!existsSync(innerDir)) bail('memory-pointer-sync', `取不到 ${innerDir}`)
  const inner = latestRound(innerDir)
  const outer = existsSync(outerDir) ? latestRound(outerDir) : null
  const rows = evaluate({ inner: inner && inner.round !== null ? inner : null, outer: outer && outer.round !== null ? outer : (outer === null ? null : outer), outerPath: outerDir })
  const bad = rows.filter((r) => r.state === 'FAIL')
  const unver = rows.filter((r) => r.state === 'UNVERIFIED').map((r) => r.id)
  // `检查 N/N` 是恒真分母（第三十六轮自查）：P2 未观测时它仍印 2/2，等于把"没比"记成"比过"。
  // 口径与 memory-volume 的 matched/mismatched 一致：已核对数只计真比过的那几条。
  const checked = rows.length - unver.length
  if (json) {
    process.stdout.write(JSON.stringify({ rows, outerPresent: outer !== null, checked, declared: rows.length }, null, 2) + '\n')
  } else {
    for (const r of rows) console.log(`${r.state} ${r.id} :: ${r.label} —— ${r.detail}`)
    console.log(`${bad.length ? 'GATE-FAIL' : 'GATE-PASS'} memory-pointer-sync :: 内层 ${(inner && inner.round) || '?'} 轮｜外层 ${(outer && outer.round) || '不在'}｜已核对 ${checked}/${rows.length}${unver.length ? `｜未验证 ${unver.join(',')}` : ''}`)
  }
  return bad.length ? 1 : 0
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  // --outer 只为"让 CI 也能驱动外层通道"：外层目录在代码仓之外，CI 检出面里永远没有它，
  // 于是"外层存在时必须观测得到"这条性质在 CI 上不可证。给一个显式注入点，夹具就能拿合成外层跑它。
  const oi = process.argv.indexOf('--outer')
  const outerDir = oi >= 0 ? resolve(process.argv[oi + 1] || '') : OUTER_MEMORY
  process.exit(main({ json: process.argv.includes('--json'), outerDir }))
}
