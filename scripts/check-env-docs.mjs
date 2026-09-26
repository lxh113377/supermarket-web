#!/usr/bin/env node
/**
 * 环境变量登记册门禁（第十轮 R10-H3）
 *
 * 动因：本轮新增 ORDER_WEBHOOK_URL 时，"未配置就 no-op"是靠代码评审口头保证的。
 * 对标取证里 litemall / minshop 都把"未配即关"写进配置类，但**没有一个项目把这条承诺
 * 变成机器判据**（实测对标组 0 家有环境变量登记表 + 一致性校验）。本仓已有
 * `verify:contract`（action 清单）与 `verify:docs`（文档数字）两道"承诺对账"，
 * 环境面是唯一还靠人记的：新增 env 忘了写文档、或文档里留着已删变量的说明，都不会红。
 *
 * 三条判据（双向 + 质量）：
 *  1. functions/** 里出现的每个 `env.X` 与 src/** 里的每个 `VITE_*` 必须在登记册有一行；
 *  2. 登记册里不允许有代码不再引用的死行（死文档比没文档更坏——它会被当作现状读）；
 *  3. 每行必须写明「未配置时行为」（这是本项目真正的安全面：secret 缺席必须降级而不是崩，
 *     且降级行为得写在纸上，不能靠读代码的人自己推）。
 *
 * 退出码：0=一致 / 1=有缺口 / 2=登记册或代码源取不到（不静默过）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY_REL = 'docs/env-vars.md'
const KINDS = new Set(['secret', 'plain', 'build', '绑定'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

/** 代码侧真值集：服务端 env.X + 构建期 VITE_*。 */
export function collectCodeVars(sources) {
  const names = new Set()
  for (const text of Object.values(sources)) {
    for (const m of text.matchAll(/(?<!\.)\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1])
    for (const m of text.matchAll(/\b(VITE_[A-Z][A-Z0-9_]+)\b/g)) names.add(m[1])
  }
  return names
}

/**
 * 登记册解析：只认「首格是合法变量名」的表格行，因此表头/分隔行/正文里的竖线都不会误入。
 * 列序固定为：变量 | 种类 | 配置位置 | 未配置时行为 | 用途。
 */
export function parseRegistry(md) {
  const rows = []
  md.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim().startsWith('|')) return
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 4) return
    const name = cells[0].replace(/`/g, '')
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) return
    rows.push({
      name, line: i + 1, kind: cells[1] || '', where: cells[2] || '',
      unset: cells[3] || '', purpose: cells[4] || '',
    })
  })
  return rows
}

/** 判定核心（纯函数，便于常驻反例覆盖）。 */
export function evaluateEnvRegistry(codeVars, rows) {
  const problems = []
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.name)) problems.push(`${REGISTRY_REL}:${r.line} 变量 ${r.name} 重复登记`)
    seen.add(r.name)
    if (!KINDS.has(r.kind)) {
      problems.push(`${REGISTRY_REL}:${r.line} ${r.name} 种类「${r.kind || '空'}」非法（须为 ${[...KINDS].join('/')}）`)
    }
    if (!r.unset) problems.push(`${REGISTRY_REL}:${r.line} ${r.name} 没写「未配置时行为」——降级必须落在纸上`)
    if (!r.where) problems.push(`${REGISTRY_REL}:${r.line} ${r.name} 没写配置位置`)
  }
  for (const name of [...codeVars].sort()) {
    if (!seen.has(name)) problems.push(`代码引用了 env.${name}，但登记册没有这一行（新增变量必须同步登记）`)
  }
  for (const r of rows) {
    if (!codeVars.has(r.name)) problems.push(`${REGISTRY_REL}:${r.line} 登记了 ${r.name}，但 functions/src 已不再引用（死文档）`)
  }
  return problems
}

export function readSources() {
  const sources = {}
  for (const dir of ['functions', 'src']) {
    const abs = join(ROOT, dir)
    let files = []
    try {
      files = walk(abs)
    } catch {
      return { sources: null, missing: dir }
    }
    for (const f of files) sources[f.slice(ROOT.length + 1)] = readFileSync(f, 'utf8')
  }
  return { sources }
}

function main() {
  const { sources, missing } = readSources()
  if (!sources) {
    console.error(`[env-docs] 代码源目录缺失：${missing}/ —— 取不到真值集就不判"通过"`)
    process.exit(2)
  }
  let md = null
  try {
    md = readFileSync(join(ROOT, REGISTRY_REL), 'utf8')
  } catch {
    console.error(`[env-docs] 登记册 ${REGISTRY_REL} 不存在或不可读`)
    process.exit(2)
  }
  const codeVars = collectCodeVars(sources)
  const rows = parseRegistry(md)
  if (!rows.length) {
    console.error(`[env-docs] ${REGISTRY_REL} 里没解析到任何登记行（表格形态错了也会导致恒绿，视为失败）`)
    process.exit(1)
  }
  const problems = evaluateEnvRegistry(codeVars, rows)
  console.log(`[env-docs] 代码引用 ${codeVars.size} 个变量，登记册 ${rows.length} 行`)
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`)
    console.error(`[env-docs] FAIL ${problems.length} 项`)
    process.exit(1)
  }
  console.log('[env-docs] OK 环境变量双向对账通过，且每行都写明未配置时行为')
}

// 只在作为命令执行时跑 main：被单测 import 时不得触发 process.exit
// （比较前先 resolve + 小写，兼容 Windows 的正斜杠/盘符大小写差异）
const isCli = !!process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main()
