#!/usr/bin/env node
/**
 * registry-sync —— 登记表 ⇄ 生产者（代码分发面）双向差集对账（第三十五轮）。
 *
 * 一手动因（本轮 Step 0 实测，不是想象）：
 *   `docs/sql-baseline.json` 43 个键，代码分发面只有 39 条 action ⇒ 4 个键没人解释；
 *   `docs/api-response-contract.json` 42 条，同样多出 **同样 3 条**（/pub getProducts、
 *   /pub stalePendingReport、/web noSuchAction）—— 它们是**越权与未知 action 的负向探针**，
 *   合法存在，但"合法"这件事今天只存在于探针代码的行号里，登记表上没有一个字。
 *   另一条 `amortized:audit-retention-purge` 是第二十八轮的采样摊销桶，**隔了 6 轮**才在本轮
 *   入册（R34 变更记录自己写着"删除 0、值变化 0"，却没人发现它一直是个漏登项）。
 *
 * 现有链路只判"代码里有、登记里没有"（verify-backend 的 `SQL 基线缺 action`），
 * **反方向"登记里有、代码里已没有"无人守** ⇒ 一个 action 被删掉后，它的基线行会永久躺着，
 * 而下一轮的人会把这行当成"还有这个能力"的证据。这是登记式台账的通用漏洞（第二十九轮已交出一次）。
 *
 * 对标（第三十五轮取证，均为 owner/name 全名）：
 *   - `kubernetes/kubernetes` `hack/lib/verify-generated.sh:35-60`：不比对 hash，而是
 *     `git worktree add -f HEAD` 到临时目录**重跑生产者**，再 `git status --porcelain | wc -l` > 0 判红；
 *     报错文案两件套 = 事实 + 修法（`hack/verify-codegen.sh:29`
 *     `"Generated files need to be updated" "Please run 'hack/update-codegen.sh'"`）。
 *     本仓的"重跑生产者"腿在 verify-backend（采样/录制），本判据核的是**它两边的集合差**。
 *   - `rust-lang/rust` `src/tools/tidy/src/deps.rs:852-854`：
 *     `"could not find exception package \`{name}\` … Remove from EXCEPTIONS list if it is no longer used."`
 *     ⇒ **例外册自身也要双向对账**，否则例外册会变成第二个没人管的登记表。本判据的 R4 就是这条。
 *
 * 退出码：0=通过 / 1=判出违规 / 2=环境或输入不满足（不判"通过"）。
 * 用法：`node scripts/check-registry-sync.mjs`（--json 出走机器可读结果）
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { bail, requireInputs, requireJson } from './lib/preflight.mjs'
import { reasonDefects } from './lib/registry-reason.mjs'
import { capped } from './lib/named-list.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BACKEND = 'functions/lib/backend.js'
export const API_CONTRACT = 'docs/api-contract.json'
export const SQL_BASELINE = 'docs/sql-baseline.json'
export const RESPONSE_CONTRACT = 'docs/api-response-contract.json'

/**
 * 例外册：**负向探针与摊销桶**造成的登记键，逐条具名理由。
 * 每条必须写"它为什么在两张表里都存在"，且理由要能被下一轮重跑证伪
 * （`reasonDefects` 强制：含实测数字或反引号命令）。
 */
export const PROBE_EXCEPTIONS = {
  'negative-probe:/pub getProducts': {
    covers: ['P:getProducts', '/pub getProducts'],
    reason: '越权探针：顾客端调 admin 专用 action 必须被拒，有信封无成功形状（`node scripts/verify-backend.mjs` 第 467 行 pubTrespass 实测 code=-1）',
  },
  'negative-probe:/pub stalePendingReport': {
    covers: ['P:stalePendingReport', '/pub stalePendingReport'],
    reason: '同一族第二出口：公开侧调看板陈旧度 action 被拒（verify-backend 第 267 行 rpPub，实测 1 条拒绝记录）',
  },
  'negative-probe:/web noSuchAction': {
    covers: ['A:noSuchAction', '/web noSuchAction'],
    reason: '未知 action 探针：分发面根本没有这个 case，靠它钉"未登记 action 不得被默认放行"（verify-backend 第 516 行）',
  },
  'amortized:audit-retention-purge': {
    covers: ['amortized:audit-retention-purge'],
    reason: '写时采样桶：functions/lib/security.js:117 `Math.random() < 0.05` 触发 90 天裁剪，属"全程发生几次"而非某次调用的峰值 ⇒ 不参与逐 action 回归（第二十八轮归因、第三十四轮才入册，迟到 6 轮）',
  },
}

/** 分发面枚举：handleAdmin 段 = /web，handlePublic 段 = /pub。 */
export function dispatchSurface(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const a = lines.findIndex((l) => l.includes('export async function handleAdmin'))
  const p = lines.findIndex((l) => l.includes('export async function handlePublic'))
  if (a < 0 || p < 0 || p < a) return { admin: new Set(), pub: new Set(), totalCases: 0, anchorLost: true }
  const grab = (s, e) => (lines.slice(s, e).join('\n').match(/case '([A-Za-z]+)'/g) || [])
    .map((m) => m.match(/case '([A-Za-z]+)'/)[1])
  const admin = new Set(grab(a, p))
  const pub = new Set(grab(p, lines.length))
  const totalCases = (source.match(/\bcase '[A-Za-z]+'\s*:/g) || []).length
  return { admin, pub, totalCases, anchorLost: false }
}

/** 纯判据（喂任意输入即可反证；夹具与真仓走同一条）。 */
export function evaluate({ pub, admin, totalCases, anchorLost, apiActions, baselineKeys, contractKeys, exceptions = PROBE_EXCEPTIONS }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok: Boolean(ok), label, detail })
  const api = new Set(apiActions || [])
  const base = new Set(baselineKeys || [])
  const shape = new Set(contractKeys || [])
  const covered = new Set(Object.values(exceptions).flatMap((e) => e.covers || []))

  if (anchorLost) {
    push('R1', false, 'R1 分发面锚点完整（两个 handler 都在）',
      'functions/lib/backend.js 里找不到 handleAdmin/handlePublic ⇒ 分发面无法枚举（缺输入不判通过）')
    return rows
  }
  push('R1', pub.size > 0 && admin.size > 0 && api.size > 0 && base.size > 0 && shape.size > 0
    && totalCases === pub.size + admin.size,
  'R1 三方分母非零 + 枚举器口径自证（case 总数 = /pub + /web 去重数）',
    totalCases !== pub.size + admin.size
      ? `分发面枚举 ${pub.size + admin.size} 条，但全文件有 ${totalCases} 个 case ⇒ 别处新增了 switch，枚举器口径要按结构改（不得放宽本条）`
      : `/pub ${pub.size} + /web ${admin.size} = ${api.size} 条在册；基线 ${base.size} 键；形状登记 ${shape.size} 条`)

  const prodKeys = new Set([...[...pub].map((x) => `/pub ${x}`), ...[...admin].map((x) => `/web ${x}`)])
  const notDeclared = [...prodKeys].filter((k) => !api.has(k))
  const notDispatched = [...api].filter((k) => !prodKeys.has(k))
  push('R2', notDeclared.length === 0 && notDispatched.length === 0,
    'R2 代码分发面 ⇄ api-contract.json 双向差集（漏登=契约说谎，多登=契约有幽灵）',
    notDeclared.length || notDispatched.length
      ? `代码有契约无: ${capped(notDeclared, 5)}｜契约有代码无: ${capped(notDispatched, 5)}`
      : `${prodKeys.size} 条双向逐字相等（0 幽灵 0 漏登）`)

  const wantBase = new Set([...[...pub].map((x) => `P:${x}`), ...[...admin].map((x) => `A:${x}`)])
  const baseMissing = [...wantBase].filter((k) => !base.has(k))
  const baseUnexplained = [...base].filter((k) => !wantBase.has(k) && !covered.has(k))
  push('R3', baseMissing.length === 0 && baseUnexplained.length === 0,
    'R3 SQL 峰值基线键 ⇄ 分发面双向（多出的键必须被例外册命名；缺的键=新调用路径没入册）',
    [baseMissing.length && `基线缺键: ${capped(baseMissing, 6)}`,
      baseUnexplained.length && `基线多键未解释: ${capped(baseUnexplained, 6)}`].filter(Boolean).join(' ; ')
      || `基线 ${base.size} 键 = 分发面 ${wantBase.size} + 基线侧例外 ${[...base].filter((k) => !wantBase.has(k)).length}（例外册共声明 ${covered.size} 个键，跨基线与形状两张表）`)

  const ghost = Object.entries(exceptions).filter(([, e]) => !(e.covers || []).some((k) => base.has(k) || shape.has(k)))
  push('R4', ghost.length === 0,
    'R4 例外册无幽灵条目（借 rust-lang/rust tidy：对不上任何登记键的例外必须删除）',
    ghost.length ? `失效例外: ${ghost.map(([n]) => n).join(', ')} ⇒ Remove from PROBE_EXCEPTIONS if it is no longer used.`
      : `${Object.keys(exceptions).length} 条例外逐条对得上登记键（covers 共 ${covered.size} 个键）`)

  const reasonBad = Object.entries(exceptions).flatMap(([n, e]) => reasonDefects(`例外 ${n}`, e.reason))
  push('R5', reasonBad.length === 0,
    'R5 例外理由必须可证伪（含实测数字或反引号命令；共用 lib/registry-reason.mjs 一份实现）',
    reasonBad.length ? reasonBad.join(' ; ') : `${Object.keys(exceptions).length} 条例外理由全部含可复跑命令或实测数字`)

  const shapeGhost = [...shape].filter((k) => !prodKeys.has(k) && !covered.has(k))
  push('R6', shapeGhost.length === 0,
    'R6 形状登记册条目必须有对应生产者（只判幽灵方向；"没覆盖到"由 api-response-contract 的 V3 判，不重复立）',
    shapeGhost.length ? `登记了形状却没有这个 action: ${capped(shapeGhost, 6)}`
      : `${shape.size} 条全部落在分发面 ∪ 例外册内`)

  return rows
}

export function loadAll(dir = root) {
  const backendSrc = readFileSync(join(dir, BACKEND), 'utf8')
  const ds = dispatchSurface(backendSrc)
  const apiDoc = JSON.parse(readFileSync(join(dir, API_CONTRACT), 'utf8'))
  const api = (apiDoc && apiDoc.endpoints) || {}   // 合法 JSON 但结构不对也不抛：让 R1 的零分母去判红
  const apiActions = [...(Object.keys(api['/pub']?.actions || {}).map((a) => `/pub ${a}`)),
    ...(Object.keys(api['/web']?.actions || {}).map((a) => `/web ${a}`))]
  const baseline = JSON.parse(readFileSync(join(dir, SQL_BASELINE), 'utf8')).peakStatements || {}
  const rcRaw = JSON.parse(readFileSync(join(dir, RESPONSE_CONTRACT), 'utf8'))
  const entries = rcRaw.entries || rcRaw
  const contractKeys = Object.keys(entries).filter((k) => !k.startsWith('_'))
  return {
    ...ds, apiActions,
    baselineKeys: Object.keys(baseline),
    contractKeys,
  }
}

export function main({ dir = root, json = false } = {}) {
  const files = [BACKEND, API_CONTRACT, SQL_BASELINE, RESPONSE_CONTRACT]
  const missing = files.map((f) => join(dir, f)).filter((p) => !existsSync(p))
  if (missing.length) bail('registry-sync', `取数文件缺失：${missing.map((m) => m.replace(dir + '/', '')).join(', ')}`)
  requireInputs('registry-sync', files.map((f) => join(dir, f)))
  // 三张登记表必须是**能解析的 JSON**：文件在但内容 0 字节时，直读 JSON.parse 会抛裸
  // SyntaxError（本仓第二十五轮把这类统一成 rc=2 + 人话诊断；这道新闸首跑就被自家零分母探针抓了一次）。
  requireJson('registry-sync', files.slice(1).map((f) => join(dir, f)))
  const input = loadAll(dir)
  const rows = evaluate(input)
  const bad = rows.filter((r) => !r.ok)
  if (json) {
    process.stdout.write(JSON.stringify({ rows, ok: bad.length === 0 }, null, 2) + '\n')
  } else {
    for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.label} (${r.detail})`)
    if (bad.length) {
      console.log('失败项:')
      for (const r of bad) console.log(`  - ${r.id} ${r.label}`)
    }
    console.log(`==== 结果: ${rows.length - bad.length} 通过 / ${bad.length} 失败 ====`)
    const line = bad.length
      ? `GATE-FAIL registry-sync :: matched ${rows.length - bad.length}/mismatched ${bad.length}（声明 ${rows.length}）`
      : `GATE-PASS registry-sync :: 分发面 ${input.pub?.size || 0}+/web ${input.admin?.size || 0} 条 ⇄ 基线 ${input.baselineKeys.length} 键 / 形状 ${input.contractKeys.length} 条｜matched ${rows.length}/mismatched 0｜检查 ${rows.length}/${rows.length} 通过，0 失败`
    console.log(line)
  }
  return bad.length ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main({ json: process.argv.includes('--json') })
}
