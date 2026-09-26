// CHANGELOG 门禁（对标第五轮 F2）：改了产品代码就必须留一条人类可读的变更记录。
// 判据：本次变更（相对 base）触及 src/** 或 functions/**，但 CHANGELOG.md 没有新增内容行 → 红。
// 逃生门：--relaxed（hotfix 场景显式跳过，需在 PR/提交说明里给出理由；跳过行为本身会打印进 CI 日志留痕）。
// 对标来源：changesets 的"changeset 随 PR 声明"思想的个人项目化——把"交付留痕"从自觉变机器。
import { spawnSync } from 'node:child_process'

const RELAXED = process.argv.includes('--relaxed')

/**
 * 比对基线的选择（第八轮 M1 收紧，原口径见下）
 *
 * 原缺陷：push 事件固定用 `HEAD~1` ⇒ 一次 push 带 N 个提交时只校验最后那一个。
 * 绕过形态实测可见：`5ea17e0..d309117` 这一推里 `0b9e405` 改了 src/functions（带 CHANGELOG），
 * 而末位 `d309117` 是纯 docs 提交 ⇒ 旧门禁直接"未触及 src/functions，跳过"。
 * 也就是说"把改动藏在不改 src 的最后一个提交后面"就能免掉门禁 —— 与本轮在 README 里
 * 抓到的"承诺写了、判据没接"是同一类。
 *
 * 现在：PR 用 base 三点 diff；push 用 webhook 给的 `before..HEAD` 整段区间；
 * `before` 缺失/非 40 位/全零（新建分支）/对象不可达（强推后被 GC 或浅克隆） ⇒ **显式告警后**回落 HEAD~1，
 * 绝不静默按"无改动"放行（R247：零输入不得记 PASS）。
 */
function resolveRange() {
  const base = process.env.GITHUB_BASE_REF
  if (base) return { mode: `origin/${base}...HEAD`, baseRev: `origin/${base}`, why: 'PR base' }
  const before = (process.env.GITHUB_EVENT_BEFORE || '').trim()
  if (/^[0-9a-f]{40}$/.test(before) && !/^0{40}$/.test(before)) {
    return { mode: `${before}..HEAD`, baseRev: before, why: 'push 区间 before..HEAD' }
  }
  if (before) {
    console.warn(`[changelog] before 不是可用 SHA（"${before.slice(0, 12)}"，多为新建分支或 force-push）→ 回落 HEAD~1`)
  }
  return { mode: 'HEAD~1', baseRev: 'HEAD~1', why: '回落：单提交' }
}

const RANGE = resolveRange()
let MODE = RANGE.mode

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || '').trim()}`)
  return r.stdout || ''
}

// 浅克隆自愈（六轮实测坑）：GitHub Actions 的 actions/checkout 默认 fetch-depth=1，
// 此时 HEAD~1 / origin/<base> / before 根本没有对象 → 上一轮的门禁在 CI 里"拒绝放行"红了两轮
// （本地全历史跑不出来，属"判据自身坏了"同族）。先尝试加深一层再判，仍失败才拒绝，
// 并且把可执行的修复指向写进日志，避免只留下一个无法自助的红灯。
function ensureRev(rev) {
  try { git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]); return true } catch { return false }
}
if (!ensureRev(RANGE.baseRev) || !ensureRev('HEAD~1')) {
  try {
    git(['fetch', '--no-tags', '--deepen=5', 'origin'])
  } catch (e) {
    console.error(`[changelog] 浅克隆加深失败：${e.message}`)
  }
}
// before 在加深后仍不可达（强推后被 GC / 浅克隆取不到）→ 回落 HEAD~1 继续校验，
// 但绝不退化成"看不见改动就放行"：回落也失败时由下面的 diff 抛错走拒绝放行分支。
if (!ensureRev(RANGE.baseRev) && RANGE.baseRev !== 'HEAD~1') {
  console.warn(`[changelog] ${RANGE.baseRev.slice(0, 8)} 不可达（浅克隆/强推）→ 回落 HEAD~1 继续校验`)
  MODE = 'HEAD~1'
}
console.log(`[changelog] 比对基线：${RANGE.why} → ${MODE}`)

let changed
try {
  changed = git(['diff', '--name-only', MODE]).split('\n').filter(Boolean)
} catch (e) {
  console.error(`[changelog] 无法取得 diff（${e.message}），门禁拒绝放行`)
  console.error('[changelog] 若是浅克隆所致：给跑本门禁的 checkout 步骤加 fetch-depth: 0（见 .github/workflows/ci.yml）')
  process.exit(1)
}

const codeTouched = changed.some((f) => /^(src|functions)\//.test(f.replace(/\\/g, '/')))
if (!codeTouched) { console.log('[changelog] 未触及 src/functions，跳过要求变更记录'); process.exit(0) }

// CHANGELOG 的"新增内容行"：diff 里以 + 开头且非标题/空行/纯符号装饰行
const clDiff = git(['diff', '--unified=0', MODE, '--', 'CHANGELOG.md'])
const hasEntry = clDiff.split('\n').some((line) =>
  line.startsWith('+') && !line.startsWith('+++') && /\S/.test(line.slice(1)) && !/^[-=*# ]+$/.test(line.slice(1).trim()))

if (!hasEntry) {
  if (RELAXED) {
    console.log('::warning::[changelog] 改了产品代码但 CHANGELOG 无新条目——--relaxed 显式跳过（hotfix 需在提交说明给出理由，本行即 CI 留痕）')
    process.exit(0)
  }
  console.error('[changelog] 本次改动触及 src/functions，但 CHANGELOG.md 的 [未发布] 段没有新增条目。')
  console.error('  补一条变更记录（做了什么/为什么/验证证据一句话），或 hotfix 场景显式 --relaxed 并在提交说明注明理由。')
  process.exit(1)
}
console.log('[changelog] 产品代码改动已附带变更记录 ✅')
