// @probe-safe: 骨架实测 rc=2 / 0.2s（缺 GITHUB_REPOSITORY 即在门口 bail），gh api 与产物写入都在其后
// 对标第四十二轮（2026-09-28）：**每条 cron 的"最近一次"有没有人量**
//
// 一手实况（本轮实测，不是假想）：
//   `LIVENESS_MODE=presence LIVENESS_WORKFLOW_ID=uptime.yml node scripts/check-backup-liveness.mjs`
//     ⇒ **rc=0 OK**，而同一时刻 `gh run list --workflow=Uptime` 第一行是
//     run 36299454141 @2026-09-27T06:13:21Z event=schedule conclusion=**failure**；
//     它认的那次"OK"是 09-26T12:05:18Z 的一次 **workflow_dispatch** —— 手动补跑顶掉了调度层的真话。
//   `d1-backup.yml` 自 09-26 起连续 2 次 scheduled 判红（日志原文 `::error::未配置 CF_D1_BACKUP_TOKEN`），
//     它自己的存活判据判 FAIL 是**设计如此**（响亮失败），但全仓没有任何一处把"连红几次"摊出来。
// ⇒ 现成的那把尺量的是"窗口内有没有成功过"（**存在性**），没人量"最近一次是不是红的、连红几天"（**趋势**）。
//    同一事实的两半只量了一半 —— 本轮换尺就换到没人量的那一半。
//
// 三态（禁把"取不到"读成"没问题"）：
//   OK         = 最近一次 scheduled run 成功，且龄期 <= 周期*2 + 1 天缓冲
//   RED        = 最近一次 scheduled run 没成功 / 停摆 / 被禁用 / 远端已消失
//   UNVERIFIED = 取不到读数 ⇒ rc=2，绝不并入 OK（Blindness is not zero）
// 取数面是**结构性枚举**（扫 .github/workflows/*.yml 找 schedule: 触发器），禁手抄清单；
// 并与远端 `actions/workflows` 注册面**双向对账**。登记册 docs/cron-health.json 由 --update 生成，
// 判据侧做双向对账：改工作流不改册即红。已知的"暂时允许红"必须写 accepts_red_until + 可证伪理由
// （复用 lib/registry-reason 那一份实现），过期即红 —— 豁免要留名，不许沉默。
//
// 用法：node scripts/check-cron-health.mjs                真仓全量校验（需 GITHUB_REPOSITORY）
//       node scripts/check-cron-health.mjs --update       重写登记册（只写非凭据事实）
//       node scripts/check-cron-health.mjs --fixture F    喂合成读数（夹具/演练，不碰网络）
//       node scripts/check-cron-health.mjs --inject-red   演习：注入一条假红，必须当场判红
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reasonDefects } from './lib/registry-reason.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dirname, '..')
export const SELF = 'scripts/check-cron-health.mjs'
export const REGISTRY = 'docs/cron-health.json'
export const WORKFLOW_DIR = '.github/workflows'
const DAY_MS = 86_400_000
export const LOOKBACK_DAYS = 7

/** 单条 cron ⇒ 周期天数。只认日级及以日内；解不出的返回 null，由上层记 UNVERIFIED 而不是猜一个。 */
export function cronPeriodDays(expr) {
  const f = String(expr || '').trim().split(/\s+/)
  if (f.length !== 5) return null
  const [mi, h, dom, mon, dow] = f
  if (mon !== '*' || (dom !== '*' && dow !== '*')) return null
  const step = (x) => { const m = /^\*\/(\d+)$/.exec(x); return m ? Number(m[1]) : null }
  if (h === '*') { const s = step(mi); return s === null ? null : s / 1440 } // "*/30 * * * *" = 每 30 分钟
  if (mi === '*') return 1 / 60
  if (!/^\d+$/.test(h)) return null
  const everyN = step(dom) ?? step(dow)
  return everyN ?? 1
}

/** 结构性枚举：哪些工作流声明了 `schedule:`。返回 [{file, name, exprs[]}]；无 schedule 的文件不入面。 */
export function enumerateScheduled(workflows) {
  const out = []
  for (const [file, src] of Object.entries(workflows)) {
    // 注释行/空行先摘掉再走结构：`uptime.yml` 的 `- cron:` 前面有**两行注释**，
    // 不摘就会在遇到注释时退出 schedule 块 ⇒ 该 cron 静默离面（本轮第一版就犯了这个，夹具当场抓到）。
    const lines = src.split(/\r?\n/).filter((l) => !/^\s*(?:#.*)?$/.test(l))
    const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l))
    if (onIdx === -1) continue
    let schedIdx = -1
    for (let i = onIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break
      if (/^\s+schedule:\s*$/.test(lines[i])) { schedIdx = i; break }
    }
    if (schedIdx === -1) continue
    const exprs = []
    for (let i = schedIdx + 1; i < lines.length; i++) {
      const m = /^\s*-\s*cron:\s*['"]?([^'"\n#]*?)['"]?\s*(?:#.*)?$/.exec(lines[i])
      if (m && m[1].trim()) { exprs.push(m[1].trim()); continue }
      if (/^\s*-\s+/.test(lines[i])) continue
      break
    }
    const nameM = /^name:\s*['"]?(.*?)['"]?\s*$/m.exec(src)
    // **反向断言的载体**：有 schedule: 块却一条 cron 都没解出来 ⇒ 不许静默不入面，
    // 要带着 unparsed:true 进面，由 C2 点名判红。第一版就是这里 `continue` 掉了
    // `d1-backup.yml`（它那行 cron 后面挂着 `# UTC 20:00 = 北京 04:00` 的尾注释），
    // 被"枚举结果里没有备份链"这个反常当场抓住 —— 枚举器自己不报错就是最坏的静默失效。
    out.push({ file, name: nameM ? nameM[1] : file, exprs, unparsed: !exprs.length })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** 读工作流目录 ⇒ {文件名: 源码}。只有 .yml/.yaml，不递归（workflows 不放子目录）。 */
export function readWorkflows(dir = join(ROOT, WORKFLOW_DIR)) {
  if (!existsSync(dir)) return {}
  const out = {}
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue
    try { out[f] = readFileSync(join(dir, f), 'utf8') } catch { out[f] = '' }
  }
  return out
}

export function ghApi(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
}

/**
 * 逐条 cron 出三态。**连红只数 event === 'schedule'**：手动 dispatch 成功不得顶替调度层
 * （本轮一手：presence 模式的旧尺就是这样把一条最近判红的 cron 读成 OK 的）。
 */
export function judgeScheduled({ declared, remote, runs, registry, nowIso, excludeRunId }) {
  const nowMs = Date.parse(nowIso)
  const periodDays = declared.periodDays
  const name = declared.name
  const remoteEntry = (remote || []).find((w) => (w.path || '').split('/').pop() === declared.file)
  const reg = (registry || []).find((r) => r.workflow === declared.file) || null
  const rec = {
    file: declared.file, name, periodDays, exprs: declared.exprs, unparsed: declared.unparsed === true,
    remoteState: remoteEntry ? remoteEntry.state : 'absent',
    total: Array.isArray(runs) ? runs.length : null,
  }
  // 反向断言的第一站：解不出 cron 的 schedule 块**不判绿也不判红**，判 UNVERIFIED ——
  // 判红会把"我自己的枚举器有洞"伪装成"那条 cron 挂了"，判绿则是漏面。
  if (rec.unparsed) { rec.state = 'UNVERIFIED'; rec.why = '有 schedule: 块却一条 cron 都没解出来 ⇒ 该 cron 整条漏量（C2 同因点名）'; return { rec, reg } }
  if (!Array.isArray(runs)) { rec.state = 'UNVERIFIED'; rec.why = '取不到 run 历史（网络/鉴权/接口形态变了）'; return { rec, reg } }
  // 两条来自同行取证的口径（`koala73/worldmonitor :: scripts/check-railway-reconcile-age.mjs:225-230`）：
  //  ① **排除自己**：本件会被 uptime.yml 那条 cron 自己调用 —— 不排掉当前 in_progress 的 run，
  //     "刚修好几秒钟又被自己判成红"，而且它结论是 null，会被当成"最近一次失败"。
  //  ② **未完成的 run 一律不入判定**（conclusion 为 null 就是"还没跑完"，不是"跑坏了"）。
  const excluded = runs.filter((r) => String(r.id) === String(excludeRunId || '\u0000') || r.conclusion == null)
  const usable = runs.filter((r) => String(r.id) !== String(excludeRunId || '\u0000') && r.conclusion != null)
  rec.droppedUnfinished = excluded.length
  const scheduled = usable.filter((r) => r.event === 'schedule').sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  rec.scheduledCount = scheduled.length
  let state = 'OK'
  let why = ''
  if (!remoteEntry) { state = 'RED'; why = 'YAML 里有 schedule 触发器，远端工作流名单里却没有 ⇒ 被删或改名（幽灵）' }
  else if (remoteEntry.state !== 'active') { state = 'RED'; why = `远端 state=${remoteEntry.state} ⇒ 工作流已禁用，cron 到点也不会跑` }
  else if (!scheduled.length) {
    state = 'RED'
    why = `窗口 ${LOOKBACK_DAYS} 天内没有任何 scheduled run（共 ${runs.length} 次，全是手动/其它事件）⇒ 调度层停摆；public 仓 60 天无活动会自动禁用 schedule`
  } else {
    const last = scheduled[0]
    rec.lastScheduled = { id: last.id, at: last.at, conclusion: last.conclusion }
    rec.ageDays = (nowMs - Date.parse(last.at)) / DAY_MS
    let streak = 0
    for (const r of scheduled) { if (r.conclusion === 'success') break; streak++ }
    rec.redStreak = streak
    if (periodDays === null) { rec.state = 'UNVERIFIED'; rec.why = `cron 表达式解不出周期：${declared.exprs.join(' | ')}`; return { rec, reg } }
    const allowed = periodDays * 2 + 1 / 24
    if (rec.ageDays > allowed) { state = 'RED'; why = `最近一次 scheduled run 在 ${rec.ageDays.toFixed(2)} 天前（周期 ${periodDays} 天，容许 <=${allowed.toFixed(2)} 天）⇒ 到点没跑` }
    else if (last.conclusion !== 'success') { state = 'RED'; why = `最近一次 scheduled run 结论=${last.conclusion}（连红 ${streak} 次）⇒ run ${last.id} @${last.at}` }
    else why = `最近一次 scheduled run success（run ${last.id} @${last.at}，龄期 ${rec.ageDays.toFixed(2)} 天）`
  }
  // 已知的红必须**具名 + 限期 + 理由可证伪**，否则不叫豁免叫沉默
  if (state === 'RED' && reg && reg.accepts_red_until) {
    const until = Date.parse(reg.accepts_red_until)
    const reasonOk = reasonDefects(`${declared.file} 的 accepts_red_reason`, reg.accepts_red_reason || '')
    if (!Number.isFinite(until)) { why += '｜accepts_red_until 解不出日期 ⇒ 豁免无效' }
    else if (until < nowMs) { why += `｜豁免已于 ${reg.accepts_red_until} 到期 ⇒ 该红重新生效` }
    else if (reasonOk.length) { why += `｜豁免理由不合格：${reasonOk.join(' / ')}` }
    else { rec.warned = true; rec.state = 'OK'; rec.why = `${why}｜已具名豁免至 ${reg.accepts_red_until}（WARN 不拦）`; return { rec, reg } }
  }
  rec.state = state
  rec.why = why
  return { rec, reg }
}

/** 纯判据门面。rows = 七条腿；per = 逐条 cron 的读数。registry 可为整份 JSON 或 entries 数组。 */
export function evaluate({ workflows, remote, runsByName, registry, nowIso, inject = null, excludeRunId = null }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const entries = Array.isArray(registry) ? registry : ((registry && registry.entries) || [])
  const declared = enumerateScheduled(workflows).map((d) => ({ ...d, periodDays: cronPeriodDays(d.exprs[0]) }))
  const per = declared.map((d) => judgeScheduled({
    declared: d, remote, runs: runsByName[d.file], registry: entries, nowIso, excludeRunId,
  }).rec)
  // 演习通道：注入红，验证 C6 这条腿不是摆设（注入面与产物面靠 `INJECTED` 前缀可分）
  if (inject) for (const p of per) {
    if (!inject.files || inject.files.includes(p.file)) { p.state = 'RED'; p.warned = false; p.why = `INJECTED 演习注入（${inject.tag}）：本条必须被 C6 抓到` }
  }

  push('C1', declared.length > 0, 'C1 声明面非空（结构性枚举，零输入不得 PASS）',
    `${WORKFLOW_DIR} 里枚举到 ${declared.length} 条带 schedule: 的工作流（一条都没有 = 取数面坏了，不是"没有 cron 所以安全"）`)

  const unparsed = declared.filter((d) => d.unparsed).map((d) => d.file)
  const unknown = per.filter((p) => p.state === 'UNVERIFIED' && p.periodDays === null && !unparsed.includes(p.file)).map((p) => p.file)
  push('C2', unparsed.length === 0 && unknown.length === 0, 'C2 每条 schedule: 都真被枚举到且周期解得出（反向断言：漏面必点名）',
    (unparsed.length ? `有 schedule: 块却解不出 cron（会被静默漏掉）: ${unparsed.join(', ')}；` : '')
    + (unknown.length ? `周期解不出: ${unknown.join(', ')}；` : '')
    + (unparsed.length === 0 && unknown.length === 0 ? `全部解出：${per.map((p) => `${p.file}=${p.periodDays}d`).join(' / ') || '（空面）'}` : ''))

  // 双向对账用**文件路径**做键，不用工作流显示名：`name:` 是 YAML 里可随手改的字符串，
  // 路径才是"这条链"的稳定身份（远端 API 的 path 末段 == 本地文件名，实测）。
  const remoteWf = (remote || []).filter((w) => (w.path || '').startsWith(WORKFLOW_DIR))
  const remoteBase = new Set(remoteWf.map((w) => (w.path || '').split('/').pop()))
  const localBase = new Set(Object.keys(workflows))
  const ghosts = per.filter((p) => !remoteBase.has(p.file)).map((p) => p.file)
  const orphanRemote = [...remoteBase].filter((b) => !localBase.has(b)).map((b) => `${b}`)
  push('C3', ghosts.length === 0 && orphanRemote.length === 0, 'C3 YAML 路径面 ⇄ 远端注册面 双向对账（按文件名，不按可改的显示名）',
    `远端 ${remoteWf.length} 条在册 ⇄ 本地 ${localBase.size} 个 YAML` + (ghosts.length ? `；幽灵（YAML 有远端没 ⇒ 被删/改名）: ${ghosts.join(', ')}` : '')
    + (orphanRemote.length ? `；远端在册而本地无此文件（多为未提交或已删）: ${orphanRemote.join(', ')}` : ''))
  const missingScheduleBlock = Object.entries(workflows)
    .filter(([f, src]) => /^\s+schedule:\s*$/m.test(src) && !per.some((p) => p.file === f)).map(([f]) => f)
  push('C3b', missingScheduleBlock.length === 0, 'C3b 有 schedule: 块的文件必须全部入面（枚举器不许自己漏）',
    missingScheduleBlock.length ? `漏面: ${missingScheduleBlock.join(', ')} ⇒ 枚举器解析有洞，这条尺现在是残的` : `入面 ${per.length} 条 == 含 schedule: 块的文件数（C2 同族反向断言的第二个方向）`)

  const missing = per.filter((p) => !entries.some((e) => e.workflow === p.file)).map((p) => p.file)
  const stale = entries.filter((e) => !per.some((p) => p.file === e.workflow)).map((e) => e.workflow)
  const badReason = entries.filter((e) => e.accepts_red_until && reasonDefects(`${e.workflow} 的 accepts_red_reason`, e.accepts_red_reason || '').length)
    .map((e) => e.workflow)
  const noCause = entries.filter((e) => e.accepts_red_until && !String(e.root_cause || '').trim()).map((e) => e.workflow)
  push('C4', missing.length === 0 && stale.length === 0 && badReason.length === 0 && noCause.length === 0,
    'C4 登记册 ⇄ 声明面 双向对账 + 豁免三件套（限期、可证伪理由、具名根因）',
    `册 ${entries.length} 条 ⇄ 声明 ${per.length} 条` + (missing.length ? `；缺条目: ${missing.join(', ')}` : '')
    + (stale.length ? `；幽灵条目（册有声明无）: ${stale.join(', ')}` : '')
    + (badReason.length ? `；豁免理由不可证伪: ${badReason.join(', ')}` : '')
    + (noCause.length ? `；豁免没写 root_cause（同因会被数成多件事）: ${noCause.join(', ')}` : ''))

  const unver = per.filter((p) => p.state === 'UNVERIFIED')
  push('C5', unver.length === 0, 'C5 每条 cron 都取到了读数（取不到不折算成健康）',
    unver.length ? `未验证 ${unver.length} 条: ${unver.map((p) => `${p.file}(${p.why})`).join(' / ')}` : `全部 ${per.length} 条有读数`)

  const reds = per.filter((p) => p.state === 'RED')
  const warns = per.filter((p) => p.warned)
  // 红**因**要归口：两条 cron 因同一件事判红，数成"两件事"就会让人去修第二遍（本轮实测正是这样：
  // uptime 的红是它自己那步 `Backup chain liveness` 把备份链的 FAIL 搬回来，不是巡检链坏了）。
  const causeOf = (f) => String((entries.find((e) => e.workflow === f) || {}).root_cause || '')
  const causes = [...new Set(reds.map((p) => causeOf(p.file)).filter(Boolean))]
  push('C6', reds.length === 0, 'C6 最近一次 scheduled run 全绿（趋势半把尺，本轮新增）',
    `${per.length} 条里 OK ${per.filter((p) => p.state === 'OK' && !p.warned).length} / RED ${reds.length} / WARN ${warns.length}`
    + (reds.length ? `；判红 ${reds.length} 条 ⇄ 具名根因 ${causes.length} 个`
      + (causes.length && causes.length < reds.length ? '（同因归并：别把它数成多件事）' : '')
      + `：${reds.map((p) => `${p.file}${causeOf(p.file) ? `[因 ${causeOf(p.file)}]` : '[未具名根因]'} — ${p.why}`).join(' ｜ ')}` : '')
    + (warns.length ? `；已具名豁免: ${warns.map((p) => `${p.file}(至 ${(entries.find((e) => e.workflow === p.file) || {}).accepts_red_until})`).join(' / ')}` : ''))

  return { rows, per }
}

export function verdictOf(rows) {
  if (!rows.every((r) => typeof r.ok === 'boolean')) return { verdict: 'UNKNOWN', rc: 2 }
  const failed = rows.filter((r) => !r.ok)
  if (!failed.length) return { verdict: 'GREEN', rc: 0 }
  // C1（枚举面空了）与 C2（块在却解不出 cron）、C5（取不到读数）同族：都是**尺子自己残**，
  // 不是"某条 cron 病了"。判红会把工具缺陷伪装成产品故障 ⇒ 一律 rc=2（UNVERIFIED）。
  return failed.some((r) => ['C1', 'C2', 'C5'].includes(r.id)) ? { verdict: 'UNVERIFIED', rc: 2 } : { verdict: 'RED', rc: 1 }
}

function printRows(rows, per) {
  for (const r of rows) {
    const tag = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP'
    console.log(`${tag}  ${r.id} ${r.label} (${r.detail})`)
  }
  console.log('')
  for (const p of per) {
    console.log(`  - ${p.file} name="${p.name}" 周期=${p.periodDays}d 远端=${p.remoteState}`
      + ` scheduled=${p.scheduledCount ?? '-'}/${p.total ?? '-'} 次`
      + (p.lastScheduled ? ` 最近=${p.lastScheduled.conclusion}@${p.lastScheduled.at} 龄期=${p.ageDays.toFixed(2)}d 连红=${p.redStreak ?? 0}` : '')
      + ` => ${p.state}${p.warned ? '(WARN)' : ''}` + (p.state !== 'OK' ? ` ｜ ${p.why}` : ''))
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const update = argv.includes('--update')
  const inj = argv.includes('--inject-red')
  const fxIdx = argv.indexOf('--fixture')
  const repo = process.env.GITHUB_REPOSITORY || process.env.CRON_HEALTH_REPO || ''
  let workflows, remote, runsByName, registry, excludeRunId = null, nowIso = new Date().toISOString()
  if (fxIdx !== -1) {
    const f = JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8'))
    workflows = f.workflows; remote = f.remote; runsByName = f.runsByName; registry = f.registry
    excludeRunId = f.excludeRunId || null
    nowIso = f.nowIso || nowIso
  } else {
    if (!repo) { console.error('[cron-health] BLOCKED 需要 GITHUB_REPOSITORY（或 --fixture 喂合成读数）⇒ 取不到不判绿'); process.exit(2) }
    workflows = readWorkflows()
    const declared = enumerateScheduled(workflows)
    if (!declared.length) { console.error('[cron-health] BLOCKED 枚举到 0 条 schedule 触发器'); process.exit(2) }
    try { remote = ghApi(`repos/${repo}/actions/workflows?per_page=100`).workflows }
    catch (e) { console.error(`[cron-health] BLOCKED 取不到工作流名单：${e instanceof Error ? e.message.split('\n')[0] : e}`); process.exit(2) }
    const since = new Date(Date.parse(nowIso) - LOOKBACK_DAYS * DAY_MS).toISOString()
    const excludeRunId = process.env.GITHUB_RUN_ID || null
    runsByName = {}
    const truncated = []
    let fetchFailed = 0
    for (const d of declared) {
      try {
        const j = ghApi(`repos/${repo}/actions/workflows/${encodeURIComponent(d.file)}/runs?per_page=30&created=>=${since}`)
        const list = (j.workflow_runs || []).map((r) => ({ id: r.id, at: r.created_at, conclusion: r.conclusion, event: r.event, status: r.status }))
        // 分页截断不得读成"没有 run / 全都好"（同上一条取证 :209,217-219）：按**去重后**的条数比 total_count
        const uniq = new Set(list.map((r) => r.id)).size
        if (Number.isFinite(j.total_count) && uniq < j.total_count) truncated.push(`${d.file}(取 ${uniq}/共 ${j.total_count})`)
        runsByName[d.file] = list
      } catch (e) { fetchFailed++; runsByName[d.file] = null; console.error(`[cron-health] 取不到 ${d.file} 的 run 历史：${e instanceof Error ? e.message.split('\n')[0] : e}`) }
    }
    if (truncated.length) { console.error(`[cron-health] BLOCKED run 列表被截断 ⇒ 分母不可信：${truncated.join(' / ')}`); process.exit(2) }
    if (fetchFailed === declared.length) { console.error('[cron-health] BLOCKED 每条 cron 都取不到 ⇒ rc=2，不判健康'); process.exit(2) }
    const regPath = join(ROOT, REGISTRY)
    registry = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : { entries: [] }
    if (update) {
      const { rows, per } = evaluate({ workflows, remote, runsByName, registry, nowIso, excludeRunId })
      void rows
      const body = {
        schema: 'chaoshi-cron-health-v1',
        note: '本件由 `node scripts/check-cron-health.mjs --update` 生成；C4 拿它与 YAML 声明面双向对账，手改即红。accepts_red_* 是人填的豁免，--update 会保留同名条目已填的值。',
        generatedUtc: nowIso, lookback_days: LOOKBACK_DAYS,
        entries: per.map((p) => {
          const old = (registry.entries || []).find((e) => e.workflow === p.file) || {}
          return {
            workflow: p.file, name: p.name, cron: p.exprs.join(' | '), period_days: p.periodDays,
            observed_state: p.state, observed_last_run: p.lastScheduled || null,
            accepts_red_until: old.accepts_red_until || '', accepts_red_reason: old.accepts_red_reason || '',
            root_cause: old.root_cause || '',
          }
        }),
      }
      writeFileSync(join(ROOT, REGISTRY), JSON.stringify(body, null, 2) + '\n', 'utf8')
      console.log(`[cron-health] 已重写 ${REGISTRY}（${body.entries.length} 条）`)
    }
  }
  const injIdx = argv.indexOf('--inject-red')
  const injFiles = injIdx !== -1 && argv[injIdx + 1] && !argv[injIdx + 1].startsWith('--') ? argv[injIdx + 1].split(',') : null
  const { rows, per } = evaluate({
    workflows, remote, runsByName, registry, nowIso, excludeRunId,
    inject: inj ? { files: injFiles, tag: injFiles ? '指定文件' : '全量' } : null,
  })
  if (inj) console.log(`[cron-health] 演习通道：注入 ${per.filter((p) => String(p.why).startsWith('INJECTED')).length} 条假红 ⇒ C6 必须判红`)
  printRows(rows, per)
  const { verdict, rc } = verdictOf(rows)
  const matched = rows.filter((r) => r.ok === true).length
  const mismatched = rows.filter((r) => r.ok !== true).length
  console.log(`==== 结果: ${matched} 通过 / ${mismatched} 失败或未验证 ｜ verdict=${verdict} ｜ cron ${per.length} 条 ====`)
  console.log(`${rc === 0 ? 'GATE-PASS' : 'GATE-FAIL'} cron-health :: 声明 ${per.length} 条｜检查 ${matched}/${rows.length} 通过，${mismatched} 失败`)
  process.exit(rc)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(join(ROOT, 'scripts', 'check-cron-health.mjs'))) {
  main().catch((e) => { console.error(`[cron-health] 未预期异常：${e && e.stack ? e.stack : e}`); process.exit(2) })
}
