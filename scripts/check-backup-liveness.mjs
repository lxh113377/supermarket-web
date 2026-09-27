#!/usr/bin/env node
// @probe-safe: 骨架实测 rc=2 / 0s（缺 GITHUB_REPOSITORY 即在门口 bail），gh api 在其后才走
/**
 * 备份链存活判据（第十二轮 R12-H1）——治的是"绿色说谎"。
 *
 * 一手实况（2026-09-26 用 API 核）：`D1 Daily Backup` 共 2 次 run，
 * `Export remote D1` 与 `Upload backup artifact` 两步 **全是 skipped**（未配 CF_D1_BACKUP_TOKEN
 * 时只发一条 ::warning::），artifact 数 **0**，而 job conclusion **success**。
 * ⇒ 自 09-24 建链以来生产库**从未被自动备份过**，而所有人看到的都是绿的。
 *
 * 所以判据不能只看 conclusion，必须看**产物与步骤实况**：
 *   1) 存在一次 run：导出步骤 = success 且 artifact ≥ 1 且 run conclusion = success；
 *   2) 那次 run 必须"新"（默认 ≤ 2 天，日级 cron 的合理上界 + 一次容错）；
 *   3) run 列表为空 ⇒ 判红（"零输入记绿"是本仓反复踩的同一族坑，见 Step 2.7 ⑤/⑥）；
 *   4) 顺手把"全 skipped 却 success"的次数摊出来，让恒绿空转的形状可见。
 * 豁免：仓库变量 `BACKUP_SKIP_OK=true` 时降级为 WARN + exit 0（**必须显式表态**，
 * 默认状态是响亮失败——沉默跳过正是本次事故的成因，不能留给它默认位）。
 *
 * 取数：`gh api`（本机与 runner 同一通道；runner 必须显式给 GH_TOKEN，
 * 这是第十一轮 pr-advisory 空转学到的：runner 上的 gh 不会自动鉴权）。
 * 退出码：0=真有备份且新鲜 / 1=没有或过期 / 2=取不到数据或参数缺失（绝不记绿）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const DAY_MS = 86400_000
/** 步骤明细取数上限（每次 run 一个 `/jobs` 调用）。默认窗口 4 天/日调度 ⇒ 4 次够用；
 *  留上限是为了"窗口被 LIVENESS_LOOKBACK_DAYS 拉大时不打爆 API"，超出的部分**必须**在输出里
 *  标明"未取"，不得与"取到了但没有步骤"同形。 */
export const STEP_DETAIL_CAP = 12

/**
 * runs: [{ id, createdAt, conclusion, event, artifactCount, steps? }]
 * mode: 'backup'（默认，要求产物与导出步骤）| 'presence'（只判"这个 cron 最近真跑成功过"，
 *       用于自动化链互指：备份链反查巡检链是否还活着）
 * cronPeriodDays：调度周期，用于**分母断言**（过滤后 scheduled run 数应 ≥ 窗口/周期）。
 */
export function judgeLiveness({ runs, nowMs, maxAgeDays = 2, exempt = false, mode = 'backup', cronPeriodDays = 1, lookbackDays = 4 }) {
  const problems = []
  const warnings = []
  if (!Array.isArray(runs)) return { problems: ['runs 不是数组（API 形态变了）'], warnings, good: null }
  if (runs.length === 0) {
    problems.push('备份工作流**从未有过任何 run** ⇒ 要么没被调度、要么仓库长期无活动；这不是"通过"，是零输入')
    return { problems, warnings, good: null }
  }
  if (!Number.isFinite(nowMs)) problems.push('nowMs 非法 ⇒ 无法算新鲜度（拒绝用"不知道"换绿）')

  // 步骤明细只有 `/actions/runs/{id}/jobs` 才有（list 接口不给 steps）。
  // 但"没有明细"不能让步骤级断言静默成立 ⇒ 计数并摊出来，否则就是 vacuous 的绿色。
  const hasStepDetail = (r) => Array.isArray(r.steps) && r.steps.length > 0
  const stepPattern = mode === 'presence' ? null : new RegExp('Export remote D1', 'i')
  // 有明细时必须真成功；没明细时不否证 —— artifact>0 本身已排除"上传被跳过"那种空转，
  // 步骤维度的缺口由上面的 blind 警告摊出来（既不假红也不假绿）。
  const stepsOk = (r) => !stepPattern || !hasStepDetail(r)
    || r.steps.some((x) => stepPattern.test(x.name || '') && x.conclusion === 'success')
  const artifactOk = (r) => mode === 'presence' || (typeof r.artifactCount === 'number' && r.artifactCount > 0)
  const isGood = (r) => r.conclusion === 'success' && stepsOk(r) && artifactOk(r)
  const good = runs.find(isGood) || null
  // 步骤明细的**覆盖度**要印成分子/分母，且"取数失败"与"没去取"不得同形（第三十六轮：
  // 旧版把两者混成一条 blind 计数，看起来像 API 不稳，其实是自己 slice(0,3) 少取了）。
  const succeeded = runs.filter((r) => r.conclusion === 'success')
  const covered = succeeded.filter(hasStepDetail).length
  const failedFetch = succeeded.filter((r) => !hasStepDetail(r) && /取 jobs 失败/.test(r.stepBlind || ''))
  const notFetched = succeeded.filter((r) => !hasStepDetail(r) && !!r.stepBlind && !/取 jobs 失败/.test(r.stepBlind || ''))
  const neverTried = succeeded.filter((r) => !hasStepDetail(r) && !r.stepBlind)
  const blind = succeeded.length - covered
  if (mode === 'backup' && blind) {
    warnings.push(`步骤明细覆盖 ${covered}/${succeeded.length} 次 success run ⇒ 缺的 ${blind} 次上步骤级断言是空话，只由 artifact 定性`
      + (failedFetch.length ? `；取数失败 ${failedFetch.length} 次（${failedFetch.map((r) => r.stepBlind).join(' / ')}）` : '')
      + (notFetched.length ? `；判据主动未取 ${notFetched.length} 次（${notFetched.map((r) => r.stepBlind).join(' / ')}）` : '')
      + (neverTried.length ? `；无取数记录 ${neverTried.length} 次（夹具态或未走到取数分支）` : ''))
  }

  const vacuous = runs.filter((r) => r.conclusion === 'success' && !isGood(r))
  if (vacuous.length) {
    warnings.push(`${vacuous.length}/${runs.length} 次 run 的 conclusion=success 但**没有产出可核对的备份证据**（恒绿空转的形状）`)
  }

  if (!good) {
    problems.push(mode === 'presence'
      ? '窗口内没有任何一次成功的 scheduled run ⇒ 该 cron 很可能已停摆（GitHub 对 public 仓"60 天无仓库活动自动禁用 schedule"是官方行为）'
      : `最近 ${runs.length} 次 run 里**没有任何一次**满足"导出步骤 success + artifact ≥ 1 + run success" ⇒ 生产库从未被这条链备份过`)
  } else if (Number.isFinite(nowMs)) {
    const then = Date.parse(good.createdAt)
    if (!Number.isFinite(then)) problems.push(`成功 run 的时间戳解不出来：${JSON.stringify(good.createdAt)} ⇒ 无法证新鲜度，按不通过处理`)
    else {
      const ageDays = (nowMs - then) / 86400_000
      if (ageDays > maxAgeDays) problems.push(`最近一次真备份是 ${ageDays.toFixed(1)} 天前（阈值 ${maxAgeDays} 天）⇒ 链已停摆（cron 被改？workflow 被禁用？配额耗尽？）`)
    }
  }

  // 调度层断言：窗口内至少要有一次 scheduled run；且最近一次的龄期不得超过 2 个周期 + 1 天缓冲。
  // 为什么不用"窗口内应有 N 次"的计数分母（本仓另一条同类判据的常规写法）：
  // 刚建链的 workflow 在窗口内天然凑不够次数，会把"昨天刚上线"报成停摆 ⇒ 假红。
  // 而 GitHub 官方那条「public 仓 60 天无仓库活动会自动禁用 schedule」的失效面，
  // 用最近一次 scheduled 的龄期同样当场暴露，且对新链友好。
  const scheduled = runs.filter((r) => r.event === 'schedule')
  if (!scheduled.length) {
    problems.push(`窗口 ${lookbackDays} 天内没有任何 scheduled run（共 ${runs.length} 次）`
      + ' ⇒ 调度层已停或被自动禁用；个别手动 dispatch 成功不代表链在跑')
  } else {
    const newest = scheduled.map((r) => ({ r, t: Date.parse(r.createdAt) })).sort((a, b) => b.t - a.t)[0]
    if (!Number.isFinite(newest.t)) {
      problems.push(`最近的 scheduled run 时间戳解不出来：${JSON.stringify(newest.r.createdAt)} ⇒ 无法证调度龄期，按不通过处理`)
    } else {
      const gapDays = (nowMs - newest.t) / 86400_000
      const allowed = cronPeriodDays * 2 + 1
      if (gapDays > allowed) {
        problems.push(`最近一次 scheduled run 在 ${gapDays.toFixed(1)} 天前（周期 ${cronPeriodDays} 天，容许 ≤${allowed} 天）`
          + ' ⇒ cron 被改/被自动禁用（public 仓 60 天无活动即触发）或动作配额耗尽')
      }
    }
  }

  if (problems.length && exempt) return { problems: [], warnings: [...warnings, `已豁免（BACKUP_SKIP_OK=true）：${problems.join('；')}`], good }
  return { problems, warnings, good }
}

function ghApi(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).toString())
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || process.env.LIVENESS_REPO || ''
  // workflow 标识支持"文件名"（实测 `actions/workflows/d1-backup.yml/runs` 可用）⇒
  // 不必再往仓库里塞一个数字 ID 变量（少一处会漂移的配置，也免得换仓就失效）
  const wfId = process.env.BACKUP_WORKFLOW_ID || process.env.LIVENESS_WORKFLOW_ID || 'd1-backup.yml'
  const fixture = process.env.LIVENESS_FIXTURE || ''
  if (!fixture && (!repo || !wfId)) {
    bail('liveness', '需要 GITHUB_REPOSITORY + BACKUP_WORKFLOW_ID（或测试用 LIVENESS_FIXTURE）')
  }
  const mode = process.env.LIVENESS_MODE === 'presence' ? 'presence' : 'backup'
  const lookbackDays = Number(process.env.LIVENESS_LOOKBACK_DAYS || 4)
  const cronPeriodDays = Number(process.env.LIVENESS_CRON_PERIOD_DAYS || 1)
  let runs
  const nowMs = Date.now()
  try {
    // 窗口化取数：不带宽界的 per_page 截断会让"push 风暴把 scheduled run 挤出列表"变成假绿
    const since = new Date(nowMs - lookbackDays * DAY_MS).toISOString()
    const raw = fixture
      ? JSON.parse(readFileSync(fixture, 'utf8'))
      : ghApi(`repos/${repo}/actions/workflows/${wfId}/runs?per_page=30&created=>=${since}`).workflow_runs
    runs = raw.map((r) => ({
      id: r.id, createdAt: r.created_at || r.run_started_at, conclusion: r.conclusion, event: r.event,
      artifacts: r.artifacts_count, steps: (r.steps || []),
    }))
  } catch (e) {
    console.error(`[liveness] BLOCKED 取不到 run 历史：${e instanceof Error ? e.message.split('\n')[0] : e} ⇒ 取不到不等于没问题`)
    process.exit(2)
  }
  // artifacts_count 在 list 接口里就有；缺失时逐个补（少一次"看不见就当 0"的假设）
  for (const r of runs) {
    if (typeof r.artifacts !== 'number' && !fixture) {
      try { r.artifacts = ghApi(`repos/${repo}/actions/runs/${r.id}/artifacts`).total_count } catch { r.artifacts = -1 }
    }
    r.artifactCount = r.artifacts ?? -1
  }
  // 摊开步骤形态：第三十六轮把"只取最近 3 次"改成**窗口内全取**（上限见 STEP_DETAIL_CAP）。
  // 一手实测：窗口=4 天扫到 4 次 run 时，第 4 次永远没有明细 ⇒ 判据自己报的
  // 「1/4 次取不到步骤明细」不是网络抖动，而是 `slice(0, 3)` 的**结构性失明**
  // （我手查那次 run 有 10 个步骤，API 给得出）。N+1 的成本是每天 4 次调用，换"步骤级断言不再空转"。
  if (!fixture) {
    for (const r of runs.slice(0, STEP_DETAIL_CAP)) {
      try {
        const jobs = ghApi(`repos/${repo}/actions/runs/${r.id}/jobs`).jobs || []
        r.steps = jobs.flatMap((j) => j.steps || []).map((s) => ({ name: s.name, conclusion: s.conclusion }))
        if (!r.steps.length) r.stepBlind = 'jobs 返回 0 个步骤'
      } catch (e) {
        // 取数失败与"没去取"必须分形：前者带原因摊出来，后者是判据自己的洞。
        r.stepBlind = `取 jobs 失败：${String((e && e.message) || e).split('\n')[0].slice(0, 90)}`
      }
    }
    if (runs.length > STEP_DETAIL_CAP) {
      for (const r of runs.slice(STEP_DETAIL_CAP)) r.stepBlind = `超出步骤明细上限 ${STEP_DETAIL_CAP}（本轮未取）`
    }
  }
  const exempt = String(process.env.BACKUP_SKIP_OK || '').toLowerCase() === 'true'
  const { problems, warnings, good } = judgeLiveness({
    runs, nowMs, maxAgeDays: Number(process.env.LIVENESS_MAX_AGE_DAYS || 2), exempt,
    mode, cronPeriodDays, lookbackDays,
  })
  console.log(`[liveness] mode=${mode} 窗口=${lookbackDays}天 周期=${cronPeriodDays}天 扫到 ${runs.length} 次 run；新鲜度阈值 ${process.env.LIVENESS_MAX_AGE_DAYS || 2} 天；豁免=${exempt ? '是' : '否'}`)
  for (const r of runs.slice(0, 5)) {
    const shape = (r.steps || []).filter((s) => /Export remote D1|Upload backup artifact/.test(s.name || ''))
      .map((s) => `${s.name}=${s.conclusion}`).join(' ')
    console.log(`  - run ${r.id} ${r.createdAt} ${r.conclusion} artifact=${r.artifactCount}${shape ? ` ｜ ${shape}` : ''}`)
  }
  for (const w of warnings) console.log(`[liveness] WARN ${w}`)
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error(mode === 'presence'
      ? '[liveness] FAIL ⇒ 这条 cron 没在按时跑（被禁用／改期／配额耗尽）。去 Actions 看该 workflow 的最近 run，别猜成网络问题'
      : '[liveness] FAIL ⇒ 备份不可依赖。两条出路见 .github/workflows/d1-backup.yml 顶部注释；要显式接受"暂时不备份"就设仓库变量 BACKUP_SKIP_OK=true（会降为 WARN，但别再让它沉默）')
    process.exit(1)
  }
  console.log(`[liveness] OK 最近一次可核对备份：run ${good.id}（${good.createdAt}，artifact=${good.artifactCount}）`)
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main()
}
