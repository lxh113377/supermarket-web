#!/usr/bin/env node
// 打印页面 与 上游仓库（k01055119509-lang/CampusPrint-V1）一致性判据。
//
// 为什么立这条闸（一手起因，2026-10-22）：打印页已整体换成该仓库的学生端静态面
//   frontend/shared/** -> public/shared/**、frontend/user/** -> public/user/**、
//   frontend/user/index.html -> public/print/index.html
// 「必须一直保持一致」这个要求此前只活在 CHANGELOG 的散文里 -- 散文不是判据：
// 上游一发版、或有人手改了 public/ 下某件，没有任何东西会红。本件把它变成机器闸。
//
// 三态（本仓统一口径，绝不把「读不到」当「没问题」）：
//   PASS(0)       双向逐文件对账 + 版本对账 + 登记册 + 龄期四条全绿
//   FAIL(1)       任一漂移（缺件 / 多件 / 内容不同 / 版本不同 / 登记册缺字段）
//   UNVERIFIED(2) 权威源取不到（上游仓库不在盘面）=> 没有对象可判，不记绿
//
//   node scripts/print-parity.mjs                     # 真面
//   node scripts/print-parity.mjs --json              # 机器消费面
//   node scripts/print-parity.mjs --selftest          # 判据自证（合成面双向腿）
//   CAMPUSPRINT_SRC=<dir> node scripts/print-parity.mjs   # 显式指定权威源
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, posix, sep, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SELF = 'scripts/print-parity.mjs'

// 登记册（真相源的指针 + 上次同步时刻），与 docs/ 其他台账同一存放处。
export const REGISTRY_REL = 'docs/campus-print.json'
// 前端产物里烘焙的版本常量所在文件（第三条腿的对账面）。
export const PRINT_APP_REL = 'src/pages/print/printApp.ts'
// 权威源候选（按序取第一个存在的）：env 显式 > CI 里 checkout 到仓库根的 vendor >
// 外层工作区同级 > 工作区根。CI 用 .github/workflows/ci.yml 的 checkout step 把上游
// （公开仓，零凭据）拉到 vendor/CampusPrint-V1 —— 本机没有该目录时按三态记 UNVERIFIED，
// 绝不折算成「一致」；本机链走 --advisory（见 package.json 的两个别名分工）。
export const SOURCE_CANDIDATES = [
  process.env.CAMPUSPRINT_SRC || '',
  join(ROOT, 'vendor', 'CampusPrint-V1', 'frontend'),
  join(ROOT, '..', '..', 'CampusPrint-V1', 'frontend'),
  join(ROOT, '..', 'CampusPrint-V1', 'frontend'),
].filter(Boolean)

// 落地映射：权威源相对路径 -> 本站 public 相对路径（与 vendored 那一次的动作逐字一致）。
export const MAPPINGS = [
  { from: 'shared', to: 'shared', kind: 'dir' },
  { from: 'user', to: 'user', kind: 'dir' },
  { from: 'user/index.html', to: 'print/index.html', kind: 'file' },
]

// 行尾归一后取 SHA：vendored 时只做过 CRLF->LF 一件事，判据必须用同一把尺。
export function normSha(buf) {
  const text = Buffer.from(buf).toString('utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// 递归列目录内文件（POSIX 相对路径）。
export function walk(dir, base = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base ? base + '/' + name : name))
    else out.push(base ? base + '/' + name : name)
  }
  return out.sort()
}

// 一个映射产出的 {落地路径: 权威源路径} 对表。
export function pairsFor(srcDir, mapping) {
  const abs = join(srcDir, mapping.from)
  if (!existsSync(abs)) return null
  if (statSync(abs).isFile()) return [{ dest: mapping.to, src: mapping.from }]
  return walk(abs).map((rel) => ({ dest: posix.join(mapping.to, rel), src: posix.join(mapping.from, rel) }))
}

// 取数面：权威源 + 落地面 + 版本面 + 登记册，任一取不到即 UNVERIFIED。
// srcOverride：--src 传入（夹具用合成权威源驱动 P1 的反例腿，不碰真盘）。
export function readSources(srcOverride = null) {
  const srcDir = srcOverride || SOURCE_CANDIDATES.find((p) => existsSync(join(p, 'shared')) && existsSync(join(p, 'user')))
  if (!srcDir) return { missing: '权威源（上游仓库 frontend/）不存在，候选：' + SOURCE_CANDIDATES.join(' | ') }
  const pubDir = join(ROOT, 'public')
  if (!existsSync(join(pubDir, 'print', 'index.html'))) return { missing: '落地面 public/print/index.html 不存在 => 打印页静态面已不在盘面' }
  const expected = {}, actual = {}
  const holes = []
  for (const m of MAPPINGS) {
    const pairs = pairsFor(srcDir, m)
    if (!pairs) { holes.push('权威源缺目录 ' + m.from); continue }
    for (const { dest, src } of pairs) {
      const srcAbs = join(srcDir, src.split('/').join(sep))
      const dstAbs = join(pubDir, dest.split('/').join(sep))
      if (!existsSync(srcAbs)) { holes.push('权威源缺件 ' + src); continue }
      expected[dest] = normSha(readFileSync(srcAbs))
      actual[dest] = existsSync(dstAbs) ? normSha(readFileSync(dstAbs)) : '<ABSENT>'
    }
  }
  if (holes.length) return { missing: '映射失配：' + holes.join(' | ') }
  // 落地面反向：public/{shared,user} 里上游没有的文件也算漂移（本站私加）
  for (const dir of ['shared', 'user']) {
    const abs = join(pubDir, dir)
    if (!existsSync(abs)) continue
    for (const rel of walk(abs)) if (!(dir + '/' + rel in expected)) actual[dir + '/' + rel] = '<EXTRA>'
  }
  let registry = null
  try { registry = JSON.parse(readFileSync(join(ROOT, REGISTRY_REL), 'utf8')) } catch { registry = null }
  // 上游 commit：CI 的 checkout step 与本机 vendor 都带 .git；读不到 = 取数面缺 ⇒ 整判据 UNVERIFIED。
  let upstreamCommit = null
  try {
    upstreamCommit = execFileSync('git', ['-C', join(srcDir, '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch { upstreamCommit = null }
  let upstreamVersion = null
  const upPkg = join(srcDir, '..', 'package.json')
  try { upstreamVersion = JSON.parse(readFileSync(upPkg, 'utf8')).version } catch { upstreamVersion = null }
  let buildConst = null
  try {
    const src = readFileSync(join(ROOT, PRINT_APP_REL), 'utf8')
    const mm = /CAMPUS_PRINT_BUILD\s*=\s*'([^']+)'/.exec(src)
    buildConst = mm ? mm[1] : null
  } catch { buildConst = null }
  return { srcDir, expected, actual, registry, upstreamVersion, buildConst, upstreamCommit }
}

export function compareMaps(expected, actual) {
  const missing = Object.keys(expected).filter((p) => !(p in actual)).sort()
  const extra = Object.keys(actual).filter((p) => !(p in expected)).sort()
  const drift = Object.keys(expected).filter((p) => p in actual && expected[p] !== actual[p]).sort()
  return { missing, extra, drift, compared: Object.keys(expected).length }
}

// 纯函数判定核心：全部判定都在这里，夹具只喂合成数据。
export function evaluate({ expected, actual, registry, upstreamVersion, buildConst, upstreamCommit = null, maxAgeDays = 30, now = Date.now() }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const cmp = compareMaps(expected || {}, actual || {})
  const total = Object.keys(expected || {}).length
  const dirty = cmp.missing.length + cmp.extra.length + cmp.drift.length
  push('P1', total > 0 && dirty === 0,
    'P1 打印页静态面 与 上游仓库逐文件双向对账（缺/多/内容漂移三类全堵）',
    total === 0
      ? '权威源映射出 0 个文件 => 没有对象可判（空集绝不记绿）'
      : dirty
        ? '漂移：缺件 ' + (cmp.missing.join(', ') || '-') + ' | 多件(本站私改或漏删) ' + (cmp.extra.join(', ') || '-') + ' | 内容不同 ' + (cmp.drift.join(', ') || '-')
          + ' => 同步动作：重拷上游 frontend/{shared,user} 到 public/（只归一行尾，不改内容）并跑 npm run build'
        : '双向对账成立：' + total + ' 件逐文件 SHA 相同（尺=内容归一行尾后的 SHA-256）')

  const regOk = !!registry && typeof registry.sourceVersion === 'string'
    && typeof registry.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(registry.sourceCommit)
    && typeof registry.syncedUtc === 'string' && !Number.isNaN(Date.parse(registry.syncedUtc))
  // 拦的是「内容」，P1 那把尺；登记册是「出处」。上游若只改了 docs（前端面没动），
  // P1 照样绿而 commit 会变 —— 此时把 P2 判红就是误报，所以 commit 差异只印出来不拦。
  const observed = upstreamCommit ? upstreamCommit.slice(0, 7) : '(无 git 面)'
  push('P2', regOk, 'P2 同步登记册在册且字段齐备（sourceCommit 须 40hex、syncedUtc 须可解析）',
    regOk
      ? '登记：' + registry.sourceVersion + '@' + registry.sourceCommit.slice(0, 7)
        + '（同步于 ' + registry.syncedUtc + '）｜权威源当前 HEAD=' + observed
        + (upstreamCommit && upstreamCommit !== registry.sourceCommit ? ' ⇒ 上游已前进；P1 按内容判，内容仍一致就不算漂' : '')
      : '登记册 ' + REGISTRY_REL + ' 读不到或缺字段 => 一致性靠人记等于没记')

  const verProblems = []
  if (!upstreamVersion) verProblems.push('权威源 package.json 读不到')
  if (registry && upstreamVersion && registry.sourceVersion !== upstreamVersion) {
    verProblems.push('登记册 sourceVersion=' + registry.sourceVersion + ' 而权威实测=' + upstreamVersion)
  }
  if (registry && buildConst && registry.sourceVersion !== buildConst) {
    verProblems.push('产物常量 CAMPUS_PRINT_BUILD=' + buildConst + ' 与登记册=' + registry.sourceVersion + ' 不同值')
  }
  if (registry && !buildConst) verProblems.push(PRINT_APP_REL + ' 里找不到 CAMPUS_PRINT_BUILD')
  push('P3', verProblems.length === 0, 'P3 版本三处对账（权威 package.json 与 登记册 与 产物常量）',
    verProblems.length ? verProblems.join(' | ') : '三处同值：' + upstreamVersion)

  let freshOk = false, freshDetail = ''
  if (regOk) {
    const ageDays = (now - Date.parse(registry.syncedUtc)) / 86400000
    freshOk = ageDays <= maxAgeDays
    freshDetail = '龄期 ' + ageDays.toFixed(1) + ' 天（阈值 ' + maxAgeDays + '）'
      + (freshOk ? '' : ' => 超期：上游若已发版，本站打印页就是旧的；重新同步并重跑本判据')
  } else freshDetail = '登记册缺 => 无从判新鲜'
  push('P4', freshOk, 'P4 同步龄期 <= ' + maxAgeDays + ' 天（久不同步 = 事实漂移的前兆）', freshDetail)

  const rc = rows.every((r) => r.ok) ? 0 : 1
  return { rows, rc, compared: total, drift: cmp }
}

// 合成面自证：正例 + 六条反例（每条只让一个面变坏，证明对应腿有牙齿）。
export function selftest() {
  const base = { 'shared/api.js': 'aaa', 'user/app.js': 'bbb', 'print/index.html': 'ccc' }
  const reg = { sourceVersion: '1.4.0', sourceCommit: '0'.repeat(40), syncedUtc: new Date().toISOString() }
  const cases = []
  const t = (label, input, want) => {
    const r = evaluate({ ...input, now: Date.parse(reg.syncedUtc) })
    cases.push([label, want(r), 'rc=' + r.rc + ' 红项=' + (r.rows.filter((x) => !x.ok).map((x) => x.id).join('/') || '无')])
  }
  t('1 正例：三面齐备 => rc=0', { expected: base, actual: { ...base }, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => r.rc === 0)
  t('2 反例：落地缺一件 => P1 红且点名', { expected: base, actual: { 'shared/api.js': 'aaa', 'print/index.html': 'ccc' }, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => { const x = r.rows.find((y) => y.id === 'P1'); return !x.ok && x.detail.includes('user/app.js') })
  t('3 反例：落地多一件（本站私加）=> P1 红（反向腿，只比该有的就是单向判据）', { expected: base, actual: { ...base, 'user/mine.js': 'zzz' }, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => !r.rows.find((y) => y.id === 'P1').ok)
  t('4 反例：内容有漂移 => P1 红', { expected: base, actual: { ...base, 'shared/api.js': 'XXX' }, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => !r.rows.find((y) => y.id === 'P1').ok)
  t('5 反例：上游改版本而登记册没跟着改 => P3 红', { expected: base, actual: { ...base }, registry: { ...reg, sourceVersion: '1.3.0' }, upstreamVersion: '1.4.0', buildConst: '1.3.0' }, (r) => !r.rows.find((y) => y.id === 'P3').ok)
  t('6 反例：登记册缺 syncedUtc => P2 红', { expected: base, actual: { ...base }, registry: { sourceVersion: '1.4.0', sourceCommit: '0'.repeat(40) }, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => !r.rows.find((y) => y.id === 'P2').ok)
  t('7 反例：龄期超阈 => 只有 P4 红（证明它单独有牙齿）', { expected: base, actual: { ...base }, registry: { ...reg, syncedUtc: new Date(Date.now() - 31 * 86400000).toISOString() }, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => r.rows.filter((y) => !y.ok).map((y) => y.id).join(',') === 'P4')
  t('8 反例：权威映射 0 件 => P1 不得记绿（空集不是没问题）', { expected: {}, actual: {}, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0' }, (r) => !r.rows.find((y) => y.id === 'P1').ok)
  const bad = cases.filter(([, ok]) => !ok)
  for (const [label, ok, detail] of cases) console.log((ok ? 'PASS ' : 'FAIL ') + label + ' :: ' + detail)
  console.log('[print-parity] selftest ' + (cases.length - bad.length) + '/' + cases.length)
  return bad.length ? 1 : 0
}

function main() {
  if (process.argv.includes('--selftest')) process.exit(selftest())
  const si = process.argv.indexOf('--src')
  const s = readSources(si >= 0 ? resolve(process.argv[si + 1] || '') : null)
  if (s.missing) {
    console.error('[print-parity] UNVERIFIED：取数面缺失 -- ' + s.missing + ' => 禁止把「取不到上游」折算成「一致」')
    console.error('  修法（任一）：node scripts/sync-print.mjs --fetch（浅克隆上游到 vendor/CampusPrint-V1）；'
      + '或 CAMPUSPRINT_SRC=<上游 frontend 目录> npm run verify:print。CI 侧由 gates 的 checkout step 保证，不需手跑。')
    process.exit(2)
  }
  const r = evaluate(s)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rc: r.rc, compared: r.compared, rows: r.rows.map((x) => ({ id: x.id, ok: x.ok, detail: x.detail })) }) + '\n')
    process.exit(r.rc)
  }
  for (const x of r.rows) console.log((x.ok ? 'PASS  ' : 'FAIL  ') + x.label + ' (' + x.detail + ')')
  console.log('[print-parity] ' + (r.rc === 0 ? 'GREEN' : 'RED') + ' rc=' + r.rc + '｜对账 ' + r.compared + ' 件｜漂移 ' + (r.drift.missing.length + r.drift.extra.length + r.drift.drift.length) + ' 处')
  // --advisory：只报不拦（户内先量误报率再接闸的退路口；默认档是阻断）。
  if (process.argv.includes('--advisory') && r.rc !== 0) {
    console.warn('::warning::[print-parity] advisory 档：判红不阻断（rc 归 0），漂移见上行')
    process.exit(0)
  }
  process.exit(r.rc)
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main()
