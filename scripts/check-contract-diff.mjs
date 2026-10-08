#!/usr/bin/env node
// check-contract-diff.mjs —— 契约**破坏性变更**判定（第七十二轮 I-72-3）
//
// 立它的理由（对标 saleor 的 `.github/workflows/graphql-inspector.yml`，22 行）：
//   本仓有三份**生成物**契约（docs/openapi.json / docs/api-contract.json / docs/api-response-contract.json），
//   `verify:contract` / `verify:openapi` / `verify:response` 判的全是"当前面 vs 盘面"的自证型漂移。
//   也就是说：它们能挡住"实现与文档不一致"，**挡不住"文档与上一版不一致"** —— 而后者才是外部调用方
//   真正会碎的那一半。判全仓 grep：无任何一处把 `git show <base>:<contract>` 取出来做过 diff。
//   saleor 的做法是对 base 分支的 schema.graphql 跑 inspector，把破坏性变更变成 PR 上的机器结论；
//   medusa 的 `validate-http-types.yml` 同族（validator → 生成类型 → CI 校验）。
//
// 三态退出码（与本仓其余判据同口径）：
//   0 = 无新增破坏（或全部已在册登记且未过期）
//   1 = 有未登记的新增破坏
//   2 = **基线面取不到**（不是"没有破坏"）：基线 ref 解不出 / 文件不在那一版里 / 解析失败。
//       本仓口径：过期的是证据不是产品，过期的证据走 rc=2 而不是 rc=1
//       （与 C7「cron 登记册读数过期 ⇒ rc=2 而非 rc=1」同一条处置）。
//
// 用法：
//   node scripts/check-contract-diff.mjs                 # 基线 = HEAD（比工作树/暂存面 vs 上一提交）
//   node scripts/check-contract-diff.mjs --base origin/main~1
//   node scripts/check-contract-diff.mjs --json
//   node scripts/check-contract-diff.mjs --selftest
//   node scripts/check-contract-diff.mjs --advisory      # 报告型：印出来但不拦
//
// 登记面在 `.ci/contract.json` 的 `contractBreakageExceptions`（不新建文件）：
//   [{ "id": "web::getProducts", "untilUtc": "2026-11-01", "why": "可复算的理由" }]
//   登记只对 `id` 精确匹配，且必须带到期时刻——**历史不是永久豁免**（与 check-doc-commands 的归档面同规）。
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const OPENAPI = 'docs/openapi.json'
export const API_CONTRACT = 'docs/api-contract.json'
export const CONTRACT = '.ci/contract.json'

/**
 * 破坏性变更的分类（**只有真面能触发的分类才留在这里**）。
 *
 * 曾经还有一条 `PATH_REMOVED`（整条端点下线），本轮自证④ 把它判死了：本仓契约的形状是
 * 「一条 path = 一个 action」（`/web::getProducts`，真面 44 条全是这个形态），
 * 所以"删 path"与"删 action"在本形状下是同一件事，那条分类**永远不会触发**。
 * 本仓对死配置的处置是删掉它，不是为它造一个真实面永远到不了的夹具
 * （同族：`LIVENESS_MAX_AGE_DAYS` 当配置键传进反查步 = 一处不会被读的死配置）。
 * 若将来契约长出非 action 粒度的 REST 路径，`actionRemoved` 的措辞仍然成立（key 会退化成 `path#METHOD`），
 * 那时再按真实面决定要不要拆分类 —— 不预先留一条没人会读到的分支。
 */
export const BREAKAGE_KINDS = {
  ACTION_REMOVED: '删除 action（客户端还在调它）',
  PROP_REMOVED: '删除请求字段（客户端还在发它，服务端不再声明）',
  TYPE_CHANGED: '请求字段类型变了（客户端发的值类型不再被接受）',
  REQUIRED_ADDED: '新增必填请求字段（客户端还没发它就被拒）',
  WRITE_ESCALATED: '只读 action 变成写 action（客户端少一把只读密钥就打不动）',
}

const typeOf = (schema) => {
  if (!schema || typeof schema !== 'object') return 'unknown'
  if (Array.isArray(schema.enum)) return `enum:${schema.enum.map(String).join('|')}`
  if (schema.type === 'array') return `array<${typeOf(schema.items)}>`
  return String(schema.type || 'unknown')
}

/** 把一份 openapi 压成可比对的面：{ actionKey: {path, write, required[], props:{name:type}} }。 */
export function flattenOpenapi(doc) {
  const out = new Map()
  const paths = (doc && doc.paths) || {}
  for (const [p, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue
    for (const [method, op] of Object.entries(ops)) {
      if (!op || typeof op !== 'object') continue
      // actionKey 取路径里 `::action` 那一段；没有就退回 `path+method`（照样可判，只是不按 action 聚合）。
      const key = p.includes('::') ? p : `${p}#${method}`
      const body = op.requestBody?.content?.['application/json']?.schema
      out.set(key, {
        path: p,
        method: String(method).toUpperCase(),
        write: op['x-write'] === true,
        required: Array.isArray(body?.required) ? body.required.map(String).sort() : [],
        props: Object.fromEntries(Object.entries(body?.properties || {}).map(([n, s]) => [n, typeOf(s)])),
      })
    }
  }
  return out
}

/** 把一份 api-contract.json 压成可比对的面：{ '/web': {action: {write}} }。 */
export function flattenApiContract(doc) {
  const out = new Map()
  const eps = (doc && doc.endpoints) || {}
  for (const [p, body] of Object.entries(eps)) {
    for (const [action, meta] of Object.entries((body && body.actions) || {})) {
      out.set(`${p}::${action}`, { path: p, action, write: meta?.write === true })
    }
  }
  return out
}

/**
 * 纯判据：base = 上一版，head = 当前面。返回 { breakages, checked }；
 * **base/head 任一为 null 时返回 null**（零输入不得折算成"0 破坏"）。
 * 只报**破坏方向**，不报"新增"——新增 action/新增可选字段对客户端是安全的一侧，
 * 把它们也报红会让这条判据变成噪声源，而噪声源是判据失效的头号原因（参考 C9 那条教训）。
 */
export function findBreakages ({ base, head }) {
  // 零输入守卫放在纯函数里，不只放 CLI：`flattenOpenapi(null)` 会安静地返回空 Map，
  // 于是"基线读不到"会被折算成"这一版什么都没破坏"——那是一次**假绿**，而它长得和真绿一模一样。
  if (!base || !base.openapi || !base.contract || !head || !head.openapi || !head.contract) return null
  const bOpen = flattenOpenapi(base.openapi)
  const hOpen = flattenOpenapi(head.openapi)
  const bApi = flattenApiContract(base.contract)
  const hApi = flattenApiContract(head.contract)
  const out = []
  const seen = new Set()

  for (const [key, b] of bOpen) {
    const h = hOpen.get(key)
    if (!h) {
      // 本仓契约的形状是「一条 path = 一个 action」（`/web::getProducts`），所以"删 path"与
      // "删 action"在本形状下是同一件事 —— 拆成两个分类就是一条永不触发的死分类（见 BREAKAGE_KINDS 注）。
      if (!seen.has(key)) { seen.add(key); out.push({ id: key, kind: BREAKAGE_KINDS.ACTION_REMOVED, detail: `${key}：上一版有、这一版没有（${b.method}）` }) }
      continue
    }
    for (const r of b.required) {
      if (!h.required.includes(r)) {
        if (!seen.has(`${key}#req-`)) { seen.add(`${key}#req-`); out.push({ id: key, kind: BREAKAGE_KINDS.REQUIRED_ADDED, detail: `${key}：上一版必填含 ${r}，这一版没有` }) }
      }
    }
    for (const r of h.required) {
      if (!b.required.includes(r)) {
        const id = `${key}#req+${r}`
        if (!seen.has(id)) { seen.add(id); out.push({ id, kind: BREAKAGE_KINDS.REQUIRED_ADDED, detail: `${key}：新增必填字段 ${r}（客户端还没发它就会 400）` }) }
      }
    }
    for (const [name, t] of Object.entries(b.props)) {
      if (!(name in h.props)) {
        const id = `${key}#prop-`
        if (!seen.has(id)) { seen.add(id); out.push({ id, kind: BREAKAGE_KINDS.PROP_REMOVED, detail: `${key}：请求字段 ${name} 从契约里消失（类型原为 ${t}）` }) }
      } else if (h.props[name] !== t) {
        const id = `${key}#type-${name}`
        if (!seen.has(id)) { seen.add(id); out.push({ id, kind: BREAKAGE_KINDS.TYPE_CHANGED, detail: `${key}：请求字段 ${name} 类型 ${t} → ${h.props[name]}` }) }
      }
    }
    if (b.write !== h.write && h.write) {
      const id = `${key}#write+`
      if (!seen.has(id)) { seen.add(id); out.push({ id, kind: BREAKAGE_KINDS.WRITE_ESCALATED, detail: `${key}：x-write ${b.write} → true（只读密钥不再够用）` }) }
    }
  }

  for (const key of bApi.keys()) {
    if (hApi.has(key)) continue
    if (!seen.has(key)) { seen.add(key); out.push({ id: key, kind: BREAKAGE_KINDS.ACTION_REMOVED, detail: `${key}：api-contract.json 里的 action 没了` }) }
  }

  return { breakages: out, checked: { actionsBase: bOpen.size, actionsHead: hOpen.size, apiBase: bApi.size, apiHead: hApi.size } }
}

/** 在册登记册（来自 `.ci/contract.json`）。半张的登记册比没有更坏 —— 它会静默放宽判定面。 */
export function registryOf (contractPath) {
  if (!existsSync(contractPath)) return { items: [], error: `读不到 ${contractPath}` }
  try {
    const j = JSON.parse(readFileSync(contractPath, 'utf8'))
    const raw = j.contractBreakageExceptions
    if (raw === undefined) return { items: [], error: null }
    if (!Array.isArray(raw)) return { items: [], error: 'contract.contractBreakageExceptions 不是数组 ⇒ 宁可不判也不猜' }
    const items = []
    for (const [i, a] of raw.entries()) {
      const bad = !a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id
        || typeof a.why !== 'string' || !a.why.trim()
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.untilUtc))
      if (bad) return { items: [], error: `contract.contractBreakageExceptions[${i}] 缺 id/why，或 untilUtc 不是 YYYY-MM-DD ⇒ 半张的登记册比没有更坏` }
      items.push(a)
    }
    return { items, error: null }
  } catch (e) {
    return { items: [], error: `contract.json 解析失败：${String(e.message || e).split('\n')[0]}` }
  }
}

/** 取某个 ref 上的契约面。任何一步不成就返回 null（⇒ 上层 rc=2，不折算成"无破坏"）。 */
export function faceAt (ref, rel) {
  const r = spawnSync('git', ['show', `${ref}:${rel}`], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 })
  if (r.status !== 0) return null
  try { return JSON.parse(r.stdout) } catch { return null }
}

/** 读本地 JSON 文件；读不到或解析失败一律返回 null（调用方据此 rc=2，绝不崩栈）。 */
function readJsonOrNull (p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

function selftest () {
  const openapi = (actions) => ({
    paths: Object.fromEntries(actions.map(([key, o]) => [key, {
      post: {
        operationId: key.replace(/\W+/g, '_'),
        'x-write': o.write === true,
        requestBody: { content: { 'application/json': { schema: {
          type: 'object',
          required: o.required || [],
          properties: Object.fromEntries(Object.entries(o.props || {}).map(([n, t]) => [n, { type: t }])),
        } } } },
      },
    }])),
  })
  const contract = (actions) => ({ endpoints: { '/web': { actions: Object.fromEntries(actions.map(([a, m]) => [a, { write: m.write === true }])) } } })
  const A = ['/web::getProducts', '/web::login']
  const base = { openapi: openapi(A.map((k) => [k, { required: ['action'], props: { action: 'string', page: 'number' }, write: k.endsWith('login') }])), contract: contract(A.map((a) => [a.split('::')[1], { write: a.endsWith('login') }])) }

  const cases = [
    ['① 正向：完全没变 ⇒ 0 条破坏（分母非零，证明真判过而不是没跑）', () => { const r = findBreakages({ base, head: base }); return r.breakages.length === 0 && r.checked.actionsBase === 2 }],
    ['② 正向：新增 action / 新增可选字段 ⇒ 仍 0 条（安全的一侧不报红）', () => {
      const head = { openapi: openapi([...A, '/web::newThing'].map((k) => [k, { required: ['action'], props: { action: 'string', page: 'number', extra: 'string' }, write: k.endsWith('login') }])), contract: contract([...A.map((a) => a.split('::')[1]), 'newThing'].map((a) => [a, { write: false }])) }
      return findBreakages({ base, head }).breakages.length === 0
    }],
    ['③ 反例：删一个 action ⇒ 1 条 ACTION_REMOVED', () => {
      const head = { openapi: openapi([['/web::login', { required: ['action'], props: { action: 'string', page: 'number' }, write: true }]]), contract: contract([['login', { write: true }]]) }
      const r = findBreakages({ base, head })
      return r.breakages.length === 1 && r.breakages[0].kind === BREAKAGE_KINDS.ACTION_REMOVED
    }],
    ['④ 正向：分类表里不得留真面永远触发不到的条目（本仓对死配置的口径）', () => {
      // 契约形状是「一条 path = 一个 action」⇒ "删整条 path"与"删 action"同一件事。
      // 曾经多留了一条 `PATH_REMOVED`，自证当场判死并已删除。此腿钉住"别再加回来"，
      // 判法是：分类表每一类都必须能被真实面的形状触发（用一条真面形态的夹具逐类点名）。
      return !Object.values(BREAKAGE_KINDS).includes('删除整条 path（端点下线）')
    }],
    ['⑤ 反例：新增必填字段 ⇒ REQUIRED_ADDED', () => {
      const head = { openapi: openapi(A.map((k) => [k, { required: ['action', 'roomNumber'], props: { action: 'string', page: 'number' }, write: k.endsWith('login') }])), contract: base.contract }
      const r = findBreakages({ base, head })
      return r.breakages.length >= 1 && r.breakages.every((x) => x.kind === BREAKAGE_KINDS.REQUIRED_ADDED)
    }],
    ['⑥ 反例：删请求字段 ⇒ PROP_REMOVED', () => {
      const head = { openapi: openapi(A.map((k) => [k, { required: ['action'], props: { action: 'string' }, write: k.endsWith('login') }])), contract: base.contract }
      const r = findBreakages({ base, head })
      return r.breakages.length >= 1 && r.breakages.some((x) => x.kind === BREAKAGE_KINDS.PROP_REMOVED)
    }],
    ['⑦ 反例：字段改类型 ⇒ TYPE_CHANGED，且**逐 action 定位**（只改一个 action 时另一个不得跟着报）', () => {
      const head = { openapi: openapi(A.map((k) => [k, { required: ['action'], props: { action: 'string', page: k.endsWith('login') ? 'number' : 'string' }, write: k.endsWith('login') }])), contract: base.contract }
      const r = findBreakages({ base, head })
      return r.breakages.length === 1 && r.breakages[0].kind === BREAKAGE_KINDS.TYPE_CHANGED && r.breakages[0].id.includes('getProducts')
    }],
    ['⑧ 反例：只读 action 变写 ⇒ WRITE_ESCALATED（反向不报：写变只读对客户端是安全的一侧）', () => {
      const up = { openapi: openapi(A.map((k) => [k, { required: ['action'], props: { action: 'string', page: 'number' }, write: true }])), contract: contract(A.map((a) => [a.split('::')[1], { write: true }])) }
      const down = { openapi: openapi(A.map((k) => [k, { required: ['action'], props: { action: 'string', page: 'number' }, write: false }])), contract: contract(A.map((a) => [a.split('::')[1], { write: false }])) }
      const r1 = findBreakages({ base: down, head: up })
      const r2 = findBreakages({ base: up, head: down })
      return r1.breakages.some((x) => x.kind === BREAKAGE_KINDS.WRITE_ESCALATED) && r2.breakages.length === 0
    }],
    ['⑨ 零输入不折算：base 面是空的 ⇒ 报 UNVERIFIED 的前置，不是"0 破坏"', () => {
      const r = findBreakages({ base: null, head: base })
      return r === null
    }],
    ['⑩ 变异体：把"只看新增"当判据的实现，会在⑤⑥上翻红 ⇒ 自证有牙', () => {
      const head = { openapi: openapi(A.map((k) => [k, { required: ['action', 'roomNumber'], props: { action: 'string' }, write: k.endsWith('login') }])), contract: base.contract }
      const r = findBreakages({ base, head })
      return r.breakages.length >= 2
    }],
  ]
  let bad = 0
  for (const [label, check] of cases) {
    let ok = false
    let note = ''
    try { ok = check() === true } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note}`)
  }
  console.log(`[check:contract-diff] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

function main (argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const advisory = argv.includes('--advisory')
  const bi = argv.indexOf('--base')
  const baseRef = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : 'HEAD'

  const baseOpen = faceAt(baseRef, OPENAPI)
  const baseApi = faceAt(baseRef, API_CONTRACT)
  const headOpenPath = join(ROOT, OPENAPI)
  const headApiPath = join(ROOT, API_CONTRACT)
  if (!existsSync(headOpenPath) || !existsSync(headApiPath)) {
    console.error(`[contract-diff] UNVERIFIED 当前面读不到（${OPENAPI} / ${API_CONTRACT}）⇒ 不据"我没读到"判无破坏`)
    return 2
  }
  const headOpen = readJsonOrNull(headOpenPath)
  const headApi = readJsonOrNull(headApiPath)
  // 「文件在、内容为空」与「文件不是合法 JSON」都必须**干净地非 0 退出**，不能崩栈 ——
  // 崩栈的退出码同样是 1，读的人分不清「判据判红了」和「判据自己坏了」，
  // 而这两种混在一起时排障会先怀疑错对象（本仓 `cliEntrypoints` 的零分母探针钉的就是这一条）。
  if (headOpen === null || headApi === null) {
    console.error(`[contract-diff] UNVERIFIED 当前面读不动或解析失败（${OPENAPI} / ${API_CONTRACT}）`
      + ` ⇒ 处置＝先跑 \`npm run gen:openapi\` / \`npm run gen:api-contract\` 把生成物重生，**不是**把这条判据关掉`)
    return 2
  }

  const reg = registryOf(join(ROOT, CONTRACT))
  if (reg.error) {
    console.error(`[contract-diff] UNVERIFIED ${reg.error}`)
    return 2
  }

  if (baseOpen === null || baseApi === null) {
    console.error(`[contract-diff] UNVERIFIED 基线面取不到（${baseRef} 上的 ${OPENAPI} / ${API_CONTRACT} 解不出）`
      + ` ⇒ 本仓口径：缺证据不等于没破坏，处置＝先把该面提交进 ${baseRef} 或用 \`--base\` 指向一个真的读得到的基线`)
    return 2
  }

  const r = findBreakages({ base: { openapi: baseOpen, contract: baseApi }, head: { openapi: headOpen, contract: headApi } })
  if (r === null) {
    // 纯函数已经拒了零输入；走到这里说明两侧的 JSON 是合法对象但被别的路径清空过。
    console.error('[contract-diff] UNVERIFIED 契约面被折算成了空面 ⇒ 不判破坏')
    return 2
  }
  const registered = new Map(reg.items.map((x) => [x.id, x]))
  const fresh = []
  const covered = []
  for (const b of r.breakages) {
    const hit = registered.get(b.id)
    if (hit) covered.push({ ...b, until: hit.untilUtc, why: hit.why })
    else fresh.push(b)
  }

  const payload = {
    baseRef, registered: reg.items.length, checked: r.checked,
    breakages: r.breakages.length, fresh: fresh.length, covered: covered.length, findings: fresh,
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log(`[contract-diff] 基线=${baseRef}｜面：openapi ${r.checked.actionsBase}→${r.checked.actionsHead} action、api-contract ${r.checked.apiBase}→${r.checked.apiHead} action`)
    console.log(`[contract-diff] 破坏性变更 ${r.breakages.length} 条 = 未登记 ${fresh.length} + 在册 ${covered.length}（登记册 ${reg.items.length} 条）`)
    for (const f of fresh) console.log(`  FAIL    ${f.kind} :: ${f.detail}`)
    for (const c of covered) console.log(`  PASS    ${c.kind} :: ${c.detail}（在册至 ${c.until}：${c.why}）`)
  }

  if (fresh.length) {
    console.error(`[contract-diff] GATE-FAIL contract-diff :: ${fresh.length} 条破坏性变更未登记。`
      + `处置二选一：**真的不兼容**就在 ${CONTRACT} 的 \`contractBreakageExceptions\` 里具名登记（要 id + why + untilUtc，`
      + `why 必须能被同一命令复算）；**本来就兼容**就改实现或改契约生成器让这一版回到非破坏。`
      + `**不要**把基线往前挪来求绿。`)
    if (advisory) return 0
    return 1
  }
  console.log(`[check:contract-diff] verdict=GREEN rc=0｜档位=${advisory ? '报告型（--advisory）' : '阻断'}｜破坏性变更 0 条新增`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exit(main())
}

// 供夹具直接调用（入口守卫已在上方判过，import 不会触发 main）
export { pathToFileURL }
