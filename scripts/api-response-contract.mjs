// 对标第二十七轮（2026-09-27）：action **响应形状**的契约化与漂移对账
//
// 立它的理由（本轮实测，不是假想）：`docs/api-contract.json` 在册 31 个 /web + 8 个 /pub 共 39 个 action，
// 每条只登记 `write / cacheKey / rateBucket` 三个**属性**；而 `verify-backend.mjs` 里 116 条断言
// **一条都没有比过响应字段集合**（`grep Object.keys(...data)` 命中 0）。也就是说：后端把 `getOrders`
// 少返回一个 `updatedAt`、或给 `createOrder` 加一个可选字段，今天没有任何闸会红 —— 而这两件事
// 前者会静默改掉管理端的增量游标语义、后者会被前端当"契约里没有的字段"用掉。
//
// 形状从**真实流量**录，不手抄：`verify-backend.mjs` 的 `wrapHandle` 是本仓唯一的 action 出口，
// 它已经带着真实 payload 跑过 30 个 (side,action)。所以本判据是"观测 + 对账"，不是"我再写一遍我认为的返回"。
//
// 用法：node scripts/api-response-contract.mjs             漂移对账（CI / verify 链）
//       node scripts/api-response-contract.mjs --write     重新生成 docs/api-response-contract.json
// 退出码：0=通过 / 1=判出漂移或未具名 / 2=环境不满足（见 scripts/lib/preflight.mjs）
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { reasonDefects } from './lib/registry-reason.mjs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { requireInputs, requireJson, bail } from './lib/preflight.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
export const CONTRACT = 'docs/api-response-contract.json'
export const API_CONTRACT = 'docs/api-contract.json'
export const SELF = 'api-response-contract.mjs'

/**
 * 未录到"成功形状"的在册 action ⇒ 必须逐条具名理由（缺一条判红，幽灵理由同样判红）。
 *
 * 理由要写成**可证伪**的句子，不要写成猜测的借口。第二十九轮的实证：这里原有两条理由
 * （"要带 base64 图片才能走通校验链"、"需要提交带图片才有对象可取"）被实测证伪 ——
 * 图片在 `createSubmission` 里是**可选**的，一条 payload 就把两条缺口关掉了。
 * 判据只能保证"没登记就红"，保证不了"登记的理由是真的" ⇒ 每轮补 payload 时顺手试一次旧理由。
 */
export const RESPONSE_GAPS = {
  // 第三十四轮清零。最后一个具名缺口是 `/pub aiChat`，它的旧理由是"需要 fetch stub：verify-backend 全程
  // 离线，而 aiChat 无 key 时走规则版返回体形状不同 ⇒ 由 aiContract 的 stub 侧守" —— 这句话被本轮自己证伪：
  // 规则模式本来就不联网（线上现在正是 ai.configured=false），Dify 模式用一个按 `functions/lib/dify.js:107-109`
  // 解析字段（answer / conversation_id）打的桩就能离线跑出成功形状，且桩记录出口 ⇒
  // "分支没跑到"与"跑了但没出网"两种情况可分（见 verify-backend 的 aiChat 三条探针）。
  // 本对象与 V3 的双向对账保留：下一轮起若缺口表再出现行，理由必须写成**可证伪的句子**（第三十一轮立的规矩）。
}

/**
 * 条件字段（同一 action 的成功响应里"时有时无"的键）。必须逐条具名：
 * 前端把它们当可选读是对的，但"新加一个可选字段"这件事不能只有加字段的人知道。
 */
export const CONDITIONAL_FIELDS = {
  '/pub createOrder': ['deduplicated（幂等命中时才带；前端 Boolean() 读，缺省即非重复）'],
  '/web createProduct': ['spec（有规格才回）', 'specOptions（配了可选规格才回）',
    // 第三十五轮实测新增：createProduct 的响应回显入库文档，请求没带 images 时该键就不存在
    // （条数 cap 探针带 9 张、其余探针不带 ⇒ 同一 action 两种形状）。与下面 stock 同因。
    'images（payload 未带 images 时不返回该键；前端保存后走列表重拉，不读此返回值）',
    // 形状随 payload：payload.stock 缺省时响应就没有 stock 键。实测两个消费方都不读这个返回值
    // （ProductInlineEditForm 提交后走 onSaved() 重拉列表），所以今天是无害的；
    // 但"响应形状取决于请求里带了哪些字段"这件事必须留在册上，谁改成读返回值时会当场看到。
    'stock（payload 未带 stock 时不返回该键；两个消费方均不读此返回值）'],
  '/web seedReviews': ['skipped（本轮有跳过计数时才带）'],
}

/** 把录制结果压成契约条目（交集=保证有，并集=可能出现）。 */
export function deriveEntry(rec) {
  const inter = (lists) => lists.length ? lists.reduce((a, b) => a.filter((k) => b.includes(k))) : []
  const union = (lists) => [...new Set(lists.flat())].sort()
  const envSets = rec.ok.map((s) => s.envelope)
  const keySets = rec.ok.map((s) => s.keys)
  const errEnv = rec.err.map((s) => s.envelope)
  return {
    side: rec.side, action: rec.action, calls: rec.calls,
    dataKinds: [...new Set(rec.ok.map((s) => s.dataKind))].sort(),
    envelopeAlways: inter(envSets).sort(), envelopeSeen: union(envSets),
    keysAlways: inter(keySets).sort(), keysSeen: union(keySets),
    errEnvelopeAlways: inter(errEnv).sort(), errEnvelopeSeen: union(errEnv),
  }
}

const stable = (o) => JSON.stringify(o, Object.keys(o).sort())

/**
 * 纯判据。V1 分母 / V2 流量⇄契约 / V3 缺口对账 / V4 漂移 / V5 条件字段 / V6 空保证字段 / V7 由 main 印门面行。
 * @param derived 本次实测录制压出的契约条目
 * @param committed 已提交的 docs/api-response-contract.json（null=还没生成）
 * @param apiActions 在册的 "side action" 全集合（来自 api-contract.json）
 */
export function evaluate({ derived, committed, apiActions, gaps = RESPONSE_GAPS, conditional = CONDITIONAL_FIELDS }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const derivedKeys = Object.keys(derived || {})
  const committedKeys = Object.keys(committed || {})
  const api = new Set(apiActions || [])

  push('V1', derivedKeys.length > 0 && (apiActions || []).length > 0,
    'V1 分母非零（零输入不得 PASS：录制为空或契约缺失都不能被读成"没有漂移"）',
    `实测 (side,action) ${derivedKeys.length} 条｜在册 action ${(apiActions || []).length} 条`)

  // 只有"确实返回过成功响应"的录制才算在册声明；纯失败探针（越权/未知 action）不计
  const producing = derivedKeys.filter((k) => (derived[k].envelopeSeen || []).length > 0)
  const ghosts = producing.filter((k) => !api.has(k))
  push('V2', ghosts.length === 0,
    'V2 实测流量里能成功返回的 action 必须都在 api-contract.json 在册（幽灵=契约漏登记）',
    ghosts.length ? `未在册却有成功响应: ${ghosts.join(', ')}` : `${producing.length} 条成功响应记录全部在册（失败探针不计）`)

  const covered = new Set(producing)
  const uncovered = [...api].filter((k) => !covered.has(k))
  const missingGap = uncovered.filter((k) => !gaps[k])
  const phantomGap = Object.keys(gaps).filter((k) => !uncovered.includes(k) || !api.has(k))
  // 第三十五轮：理由本身要**可证伪**（含实测数字或反引号命令），共用 lib/registry-reason.mjs 一份实现。
  // 立它的实证：第二十九轮我写过的两条理由被一条 payload 证伪（images 本就可选）⇒ 光"有登记"不构成守住。
  const thinGap = Object.entries(gaps).flatMap(([k, r]) => reasonDefects(`缺口 ${k}`, r))
  push('V3', missingGap.length === 0 && phantomGap.length === 0 && thinGap.length === 0,
    'V3 未录到成功形状的在册 action 必须逐条具名理由，且理由可证伪（双向对账，防"少录就是少守"）',
    [missingGap.length && `未登记缺口: ${missingGap.join(', ')}`,
      phantomGap.length && `幽灵登记（其实已覆盖/不在册）: ${phantomGap.join(', ')}`,
      thinGap.length && `理由不可证伪: ${thinGap.join(' ; ')}`].filter(Boolean).join(' | ')
      || `覆盖 ${covered.size}/${api.size}，缺口 ${uncovered.length} 条全部具名且理由可证伪`)

  if (!committedKeys.length) {
    push('V4', false, 'V4 契约与实测逐字段对账（漂移=红）', 'committed 契约缺失 ⇒ 先跑 npm run gen:response-contract（缺基准不判"通过"）')
  } else {
    const drift = []
    for (const k of new Set([...derivedKeys, ...committedKeys])) {
      const a = derived[k], b = committed[k]
      if (!a) { drift.push(`${k}：契约里有、实测没录到（action 被删或 payload 变了？）`); continue }
      if (!b) { drift.push(`${k}：实测新出现、契约里没有 ⇒ 跑 --write 入册`); continue }
      if (stable(a) !== stable(b)) {
        const diff = ['dataKinds', 'envelopeAlways', 'envelopeSeen', 'keysAlways', 'keysSeen', 'errEnvelopeAlways', 'errEnvelopeSeen']
          .filter((f) => stable(a[f]) !== stable(b[f]))
        drift.push(`${k}：字段漂移 [${diff.join(',')}] 实测 ${diff.map((f) => f + '=' + JSON.stringify(a[f])).join(' ')}`)
      }
    }
    push('V4', drift.length === 0, 'V4 契约与实测逐字段对账（漂移=红）',
      drift.length ? drift.slice(0, 8).join(' ; ') + (drift.length > 8 ? ` …共 ${drift.length} 处` : '')
        : `${derivedKeys.length} 条 (side,action) 形状与已提交契约逐字段相等`)
  }

  const condFindings = []
  for (const k of derivedKeys) {
    const seen = new Set([...(derived[k].keysSeen || []), ...(derived[k].envelopeSeen || [])])
    const always = new Set([...(derived[k].keysAlways || []), ...(derived[k].envelopeAlways || [])])
    const conditionalNow = [...seen].filter((f) => !always.has(f)).sort()
    const listed = (conditional[k] || []).map((s) => s.split('（')[0])
    for (const f of conditionalNow) if (!listed.includes(f)) condFindings.push(`${k}.${f} 是条件字段但未具名`)
    for (const f of listed) if (!conditionalNow.includes(f)) condFindings.push(`${k}.${f} 登记为条件字段、实测已不再条件（幽灵登记）`)
  }
  push('V5', condFindings.length === 0,
    'V5 条件字段（时有时无的键）逐条具名 —— 前端读可选字段可以，但"新加一个可选字段"不能只有加字段的人知道',
    condFindings.length ? condFindings.slice(0, 8).join(' ; ')
      : `已具名 ${Object.values(conditional).reduce((a, v) => a + v.length, 0)} 个条件字段，与实测一致`)

  const hollow = derivedKeys.filter((k) => derived[k].dataKinds.includes('object') && !derived[k].keysAlways.length)
  push('V6', hollow.length === 0,
    'V6 data 为对象时必须有一个"保证存在"的字段（返回对象却无保证字段 = 契约是空的）',
    hollow.length ? `无保证字段的对象响应: ${hollow.join(', ')}` : '全部对象型响应都有至少一个恒定字段')

  return rows
}

/** 跑一次带录制的 verify-backend，把结果压成契约条目。 */
/**
 * 取录制：默认自己跑一遍 verify-backend（真实流量）。
 * `RESPONSE_CONTRACT_IN` 只用于"复用一份已有录制"（夹具要做的是对账逻辑的反例，
 * 不必为此重跑一次全链；真流量那一腿由 `真仓跑真流量` 用例覆盖）。
 */
export function record(dir = root) {
  const preset = process.env.RESPONSE_CONTRACT_IN || null
  if (preset) {
    if (!existsSync(preset)) bail('response-contract', `RESPONSE_CONTRACT_IN 指向的文件不存在：${preset}`)
    const raw = JSON.parse(readFileSync(preset, 'utf8'))
    const derived = {}
    for (const [k, rec] of Object.entries(raw.actions || {})) derived[k] = deriveEntry(rec)
    return { derived }
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'smresp-'))
  const outFile = join(tmpDir, 'shapes.json')
  try {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'verify-backend.mjs')], {
      cwd: dir, encoding: 'utf8', timeout: 180_000,
      env: { ...process.env, RESPONSE_CONTRACT_OUT: outFile },
    })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    if (r.status !== 0) throw new Error(`verify-backend rc=${r.status}：${out.split(/\r?\n/).slice(-3).join(' / ')}`)
    if (!existsSync(outFile)) throw new Error('verify-backend 没写出录制文件（wrapHandle 的录制段被改坏了？）')
    const raw = JSON.parse(readFileSync(outFile, 'utf8'))
    const derived = {}
    for (const [k, rec] of Object.entries(raw.actions || {})) derived[k] = deriveEntry(rec)
    return { derived, note: raw }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function apiActions(dir = root) {
  const c = JSON.parse(readFileSync(join(dir, API_CONTRACT), 'utf8'))
  const out = []
  for (const [side, v] of Object.entries(c.endpoints || {})) for (const a of Object.keys(v.actions || {})) out.push(`${side} ${a}`)
  return out
}

export function main({ dir = root, write = false } = {}) {
  requireInputs(SELF.replace('.mjs', ''), [join(dir, API_CONTRACT), join(dir, 'scripts', 'verify-backend.mjs'), join(dir, 'scripts', 'lib', 'response-shape.mjs')])
  requireJson('response-contract', [join(dir, API_CONTRACT), write ? null : join(dir, CONTRACT)])
  let derived
  try { derived = record(dir).derived } catch (e) {
    // 录制环节失败属"取不到对象"，必须报环境不满足（rc=2）而不是甩栈 —— 上一版直接 throw，
    // 在缺 db/ 的目录里跑就是一份 package_json 式裸栈，违反本仓第 25 轮定的"首行必须是人话"。
    bail('response-contract', `取不到实测录制：${String(e.message).replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  if (write) {
    const body = { version: 1, source: '由 scripts/verify-backend.mjs 的真实流量录制（wrapHandle 单点），勿手改', entries: derived }
    writeFileSync(join(dir, CONTRACT), JSON.stringify(body, null, 2) + '\n')
    console.log(`[response-contract] 已写入 ${CONTRACT}（${Object.keys(derived).length} 条）`)
    return 0
  }
  const committed = JSON.parse(readFileSync(join(dir, CONTRACT), 'utf8')).entries || null
  const rows = evaluate({ derived, committed, apiActions: apiActions(dir) })
  let bad = 0
  for (const r of rows) { if (!r.ok) bad++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.label} (${r.detail})`) }
  const ok = bad === 0 && rows.length === 6
  console.log(`${ok ? 'GATE-PASS' : 'GATE-FAIL'} response-contract :: 实测 ${Object.keys(derived).length} 条在册形状｜检查 ${rows.length - bad}/${rows.length} 通过，${bad} 失败`)
  return ok ? 0 : 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  process.exit(main({ write: process.argv.includes('--write') }))
}
