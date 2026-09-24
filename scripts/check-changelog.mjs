// CHANGELOG 门禁（对标第五轮 F2）：改了产品代码就必须留一条人类可读的变更记录。
// 判据：本次变更（相对 base）触及 src/** 或 functions/**，但 CHANGELOG.md 没有新增内容行 → 红。
// 逃生门：--relaxed（hotfix 场景显式跳过，需在 PR/提交说明里给出理由；跳过行为本身会打印进 CI 日志留痕）。
// 对标来源：changesets 的"changeset 随 PR 声明"思想的个人项目化——把"交付留痕"从自觉变机器。
import { spawnSync } from 'node:child_process'

const RELAXED = process.argv.includes('--relaxed')
// PR 事件（有 GITHUB_BASE_REF）：三点 diff 对目标分支；push/手动/本地：本次提交 vs 上一个提交
// （push 时 origin/main 已含 HEAD，三点 diff 恒空 → 门禁失效，必须走 HEAD~1）
const MODE = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : 'HEAD~1'

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || '').trim()}`)
  return r.stdout || ''
}

// 浅克隆自愈（六轮实测坑）：GitHub Actions 的 actions/checkout 默认 fetch-depth=1，
// 此时 HEAD~1 / origin/<base> 根本没有对象 → 上一轮的门禁在 CI 里"拒绝放行"红了两轮
// （本地全历史跑不出来，属"判据自身坏了"同族）。先尝试加深一层再判，仍失败才拒绝，
// 并且把可执行的修复指向写进日志，避免只留下一个无法自助的红灯。
function ensureRev(rev) {
  try { git(['rev-parse', '--verify', '--quiet', rev]); return true } catch { return false }
}
if (!ensureRev(MODE.split('...')[0].trim()) || (MODE === 'HEAD~1' && !ensureRev('HEAD~1'))) {
  try {
    git(['fetch', '--no-tags', '--deepen=3', 'origin'])
  } catch (e) {
    console.error(`[changelog] 浅克隆加深失败：${e.message}`)
  }
}

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
