#!/usr/bin/env node
// 打印页 ⇄ 上游仓库（k01055119509-lang/CampusPrint-V1）的同步执行器（判据 = scripts/print-parity.mjs）。
//
// 为什么要有它：一致性判据红了之后必须存在**一条命令能自愈**（本仓闸规：不可自愈的闸 = 长期红灯 +
//  eventually 被人绕过）。本件做的事与当初手工 vendored 完全一致：取上游 frontend/{shared,user},
// 落 public/{shared,user} + public/print/index.html，唯一变换是行尾归一（CRLF -> LF），
// 然后刷新 docs/campus-print.json 的 commit/version/时刻三处。
//
//   node scripts/sync-print.mjs              # 只报差异（dry-run，零写入）
//   node scripts/sync-print.mjs --apply      # 落盘 + 刷登记册（改完必跑 npm run build）
//   node scripts/sync-print.mjs --fetch      # 先从远端拉最新（浅克隆到 vendor/CampusPrint-V1）再比
// 退出码：0=无差异 / 1=有差异（--apply 后成功也返 0）/ 2=取数面缺失（网络或路径）
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAPPINGS, normSha, pairsFor, REGISTRY_REL, PRINT_APP_REL, readSources } from './print-parity.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'vendor', 'CampusPrint-V1')
const UPSTREAM_URL = 'https://github.com/k01055119509-lang/CampusPrint-V1.git'

function bail(msg) { console.error('[sync-print] 环境不满足：' + msg + ' => 不静默记成功（rc=2）'); process.exit(2) }

function fetchUpstream() {
  // git 在本机走 Clash 代理且代理不稳时会 TLS 截断（本轮一手：push 需重试）；
  // 这里显式带重试，且失败时报环境码而不是假装同步完成。
  const args = ['-c', 'http.sslBackend=openssl', 'clone', '--depth', '1', UPSTREAM_URL, VENDOR]
  for (let i = 1; i <= 3; i++) {
    try {
      if (existsSync(join(VENDOR, '.git'))) {
        execFileSync('git', ['-C', VENDOR, '-c', 'http.sslBackend=openssl', 'fetch', '--depth', '1', 'origin', 'HEAD'], { encoding: 'utf8' })
        execFileSync('git', ['-C', VENDOR, 'reset', '--hard', 'FETCH_HEAD'], { encoding: 'utf8' })
      } else {
        mkdirSync(dirname(VENDOR), { recursive: true })
        execFileSync('git', args, { encoding: 'utf8' })
      }
      return true
    } catch (e) {
      console.error('[sync-print] 第 ' + i + ' 次取上游失败：' + String(e.message || e).split('\n')[0])
    }
  }
  return false
}

function walk(dir, base = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base ? base + '/' + name : name))
    else out.push(base ? base + '/' + name : name)
  }
  return out.sort()
}

function main() {
  const apply = process.argv.includes('--apply')
  const wantFetch = process.argv.includes('--fetch')
  if (wantFetch && !fetchUpstream()) bail('三次重试仍取不到上游仓库（网络/代理）')
  const s = readSources()
  if (s.missing) bail(s.missing)
  const srcDir = s.srcDir
  const pubDir = join(ROOT, 'public')
  const plan = []
  // 路径解析只用判据里那份 MAPPINGS（pairsFor 是唯一算法），别在这里重写第二遍：
  // 两遍必漂，漂了就等于按错的方向覆盖正确文件。
  for (const m of MAPPINGS) {
    const pairs = pairsFor(srcDir, m)
    if (!pairs) bail('权威源缺 ' + m.from)
    for (const { dest, src } of pairs) {
      const srcAbs = join(srcDir, src.split('/').join(sep))
      const dstAbs = join(pubDir, dest.split('/').join(sep))
      const want = normSha(readFileSync(srcAbs))
      const have = existsSync(dstAbs) ? normSha(readFileSync(dstAbs)) : null
      if (want !== have) plan.push({ srcAbs, dstAbs, destRel: dest, act: have === null ? 'new' : 'update' })
    }
  }
  // 反向：落地面里权威源没有的件（排除本站自有件：public 下的商品图/sw 等不在映射目录内）
  for (const dir of ['shared', 'user']) {
    const abs = join(pubDir, dir)
    if (!existsSync(abs)) continue
    for (const rel of walk(abs)) {
      const key = dir + '/' + rel
      if (!(key in s.expected)) plan.push({ dstAbs: abs, destRel: key, act: 'delete(上游无此件)' })
    }
  }
  if (!plan.length && s.registry) {
    console.log('[sync-print] 无差异：' + Object.keys(s.expected).length + ' 件逐文件与上游相同，登记册在册')
    process.exit(0)
  }
  for (const x of plan) console.log('  ' + x.act.padEnd(16) + x.destRel)
  if (!apply) {
    console.log('[sync-print] dry-run：差异 ' + plan.length + ' 处 => 跑 node scripts/sync-print.mjs --apply 落盘')
    process.exit(1)
  }
  for (const x of plan) {
    if (x.act.startsWith('delete')) { console.error('[sync-print] 不自动删件（需人确认它不是本站自有件）：' + x.destRel); process.exit(1) }
    mkdirSync(dirname(x.dstAbs), { recursive: true })
    // 唯一变换 = 行尾归一（与判据同一把尺）；内容一字不改，改了 P1 当场红
    writeFileSync(x.dstAbs, readFileSync(x.srcAbs).toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
  }
  // 刷登记册：commit/version/时刻三处一起改（漏改 = P2/P3 当场红，故同笔完成）
  let commit = 'unknown'
  try { commit = execFileSync('git', ['-C', dirname(srcDir), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { /* 无 git 面时留 unknown，P2 会点名 */ }
  const version = s.upstreamVersion || 'unknown'
  const regPath = join(ROOT, REGISTRY_REL)
  const old = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : {}
  const next = { ...old, sourceVersion: version, sourceCommit: commit, syncedUtc: new Date().toISOString() }
  writeFileSync(regPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  // 产物常量同笔（第三处版本面）
  const appPath = join(ROOT, PRINT_APP_REL)
  if (existsSync(appPath)) {
    const src = readFileSync(appPath, 'utf8')
    const out = src.replace(/(export const CAMPUS_PRINT_BUILD = ')[^']*(')/, "$1" + version + "$2")
    if (out !== src) writeFileSync(appPath, out, 'utf8')
  }
  console.log('[sync-print] 已落盘 ' + plan.length + ' 处，登记=' + version + '@' + commit.slice(0, 7) + ' => 下一步：npm run build && npm run verify:print')
  process.exit(0)
}

main()
