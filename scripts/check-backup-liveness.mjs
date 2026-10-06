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
 * 备份产物名的**唯一形状**（R37-H1 加密出路上线后有两种）：
 * `d1-backup-<run>`（private 仓·明文）与 `d1-backup-enc-<run>`（非 private·已加密）。
 * 三条口径必须同值（由 `tests/backupArtifactName.test.ts` 钉死）：
 * 本判据认的名字 ⇄ 工作流两条上传步骤的 `name:` ⇄ 明文步骤的互斥 `if` 条件。
 * 名字与上传面漂移的后果是"备份链绿了但判据其实没在认它的产物"（同第十二轮"有守卫≠守卫会跑"）。
 */
export const BACKUP_ARTIFACT_NAME = /^d1-backup(-enc)?-\d+$/
export const BACKUP_UPLOAD_RULE = /name:\s*d1-backup(?:-enc)?-\$\{\{\s*github\.run_number\s*\}\}/
export const PLAIN_UPLOAD_GUARD = /if:[^\n]*mode == 'plaintext'/

/**
 * 第六十八轮：两种 mode 证的是**两件不同的事**，不再共用一个「必须 success」。
 *   backup   「备份真产出了可核对的产物」⇒ success + 导出步骤真成功 + artifact ≥ 1 + 名字像备份
 *   presence 「那条 cron 到点真跑了」⇒ 只要求窗口内有一条 scheduled run，**颜色不是它的职责**
 * 一手实测的成因（本轮）：presence 旧写法要求对侧 success，而对侧 success 又要求本侧真有产物
 * ⇒ 两条 cron 互为前提成环，`d1-backup.yml` 的反查步还排在 `Export remote D1` **之前**，
 * 于是**即使配上 CF_D1_BACKUP_TOKEN，备份当晚仍走不到导出**。
 * 颜色在这里降成可见的读数（`redStreak` WARN），不再是绿灯条件——静默的绿与沉默的红是同一种病。
 */
export const didFire = (r) => r.event === 'schedule' && r.conclusion != null && r.conclusion !== ''

/**
 * 从已抓到的步骤形态反推"缺哪个 secret"，把 FAIL 从"去看注释"升级成"照这条做"。
 * 只报证据支持的结论：取不到步骤明细就老实说取不到，不猜。
 */
function diagnoseSecrets(runs) {
  const withSteps = runs.filter((r) => Array.isArray(r.steps) && r.steps.length)
  if (!withSteps.length) {
    return '｜诊断：窗口内没有一份步骤明细，无法判断卡在哪个环节（这本身是失明，不是"没问题"）'
  }
  const stepOf = (r, re) => (r.steps || []).find((s) => re.test(s.name || ''))
  const exportSkipped = withSteps.filter((r) => {
    const s = stepOf(r, /Export remote D1/i)
    return s && s.conclusion === 'skipped'
  })
  const exportRan = withSteps.filter((r) => {
    const s = stepOf(r, /Export remote D1/i)
    return s && s.conclusion === 'success'
  })
  const refuseFired = withSteps.filter((r) => (r.steps || []).some(
    (s) => /Fail loudly|refuse/i.test(s.name || '') && s.conclusion === 'failure'))
  const parts = []
  if (exportSkipped.length === withSteps.length) {
    parts.push(`全部 ${exportSkipped.length} 次的「Export remote D1」都是 skipped`
      + ' ⇒ 缺 **CF_D1_BACKUP_TOKEN**（需 D1:Read 的 Cloudflare API Token）：没 token 就根本没导出，'
      + '后面所有步骤都是空转')
  } else if (exportRan.length && refuseFired.length) {
    parts.push(`导出真跑过 ${exportRan.length} 次，但可见性守卫拒绝落明文产物（"Fail loudly" 触发 ${refuseFired.length} 次）`
      + ' ⇒ 缺 **BACKUP_PASSPHRASE**：本仓是 public，第三十七轮的三态守卫在无口令时故意判红，'
      + '不静默降级成明文上传')
  } else if (exportRan.length) {
    parts.push(`导出真跑过 ${exportRan.length} 次却没有一件合格产物 ⇒ 卡在导出之后的环节（加密或上传步），需去 Actions 看该步`)
  }
  return parts.length ? '｜诊断：' + parts.join('；') : ''
}

/**
 * runs: [{ id, createdAt, conclusion, event, artifactCount, steps? }]
 * mode: 'backup'（默认，要求产物与导出步骤）| 'presence'（只判"这个 cron 到点真**跑**过"，
 *       用于自动化链互指：备份链反查巡检链是否还在调度。第六十八轮起不再要求它对侧是绿的——
 *       旧口径与巡检链的产物门互指成环，会把"配了 token 也备份不了"锁死）
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
  // 产物名字：null = 没取到（失明，单独摊出来）；false = 取了但没有一个像备份产物 ⇒ 这次跑**没产出备份**。
  const nameVerdict = (r) => (mode !== 'backup' || !Array.isArray(r.artifactNames) ? null
    : r.artifactNames.some((n) => BACKUP_ARTIFACT_NAME.test(n)))
  /** 产物级断言（只有 backup 模式该用它）：success + 导出步真成功 + artifact≥1 + 名字像备份。 */
  const isArtifactBacked = (r) => r.conclusion === 'success' && stepsOk(r) && artifactOk(r) && nameVerdict(r) !== false
  // presence 只认「到点跑过」；同一事实不在两处各判一遍（第四十二轮归口教训），
  // "到底有没有跑"由下面那条调度层断言（scheduled 为空 / 龄期超限）独占红因位。
  const isGood = mode === 'presence' ? didFire : isArtifactBacked
  if (mode === 'backup') {
    const wrong = runs.filter((r) => r.conclusion === 'success' && (r.artifactCount || 0) > 0 && nameVerdict(r) === false)
    for (const r of wrong) {
      problems.push(`run ${r.id} 有 ${r.artifactCount} 件产物但没有一件像备份（应匹配 ${BACKUP_ARTIFACT_NAME}）：实际 = ${r.artifactNames.slice(0, 4).join(', ')} ⇒ "产物数 ≥1"被非备份产物满足过就等于没备份`)
    }
    const blindNames = runs.filter((r) => r.conclusion === 'success' && (r.artifactCount || 0) > 0 && nameVerdict(r) === null).length
    if (blindNames) warnings.push(`${blindNames} 次 success run 有产物但**名字未取到** ⇒ 只由计数定性（这是未核，不是已核）`)
  }
  // presence 取**最近一条**跑过的（API 默认按时间倒序，但不依赖它：显式按时间戳取最大，
  // 解不出时间戳的排最后，免得 NaN 把排序变成随机序 ⇒ 龄期断言会读到一条旧 run）。
  const tOf = (r) => { const t = Date.parse(r.createdAt); return Number.isFinite(t) ? t : -1 }
  const good = mode === 'presence'
    ? (runs.filter(isGood).sort((a, b) => tOf(b) - tOf(a))[0] || null)
    : (runs.find(isGood) || null)
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

  // 「恒绿空转」是**备份面**的病：success 却没有可核对的产物。presence 面不认产物，
  // 用它判 presence 只会造出一句与本次断言无关的读数（第四十三轮 R43-H1 同一族：别把没断言的说成断言过）。
  const vacuous = mode === 'backup' ? runs.filter((r) => r.conclusion === 'success' && !isArtifactBacked(r)) : []
  if (vacuous.length) {
    warnings.push(`${vacuous.length}/${runs.length} 次 run 的 conclusion=success 但**没有产出可核对的备份证据**（恒绿空转的形状）`)
  }

  if (!good) {
    if (mode === 'presence') {
      // 这里**不再判一次红**：presence 的 good = 「有一条 scheduled run 出过结论」，
      // 它为空 ⟺ 下面调度层断言的 `scheduled.length === 0`（或全在跑中）⟹ 同一红因出两行，
      // 会让人以为要修两遍（第四十二轮归口教训）。红由调度层那一处独占，本行只把形状摊出来。
      const sched = runs.filter((r) => r.event === 'schedule')
      if (sched.length) {
        warnings.push(`${sched.length} 条 scheduled run 都没有结论字段（多半还在跑或 API 未回 conclusion）`
          + ' ⇒ 本步的龄期断言照常判，颜色读数缺失，不按"全绿"也不按"全红"计')
      }
    } else {
      // 措辞必须被证据撑住：本判据只看得到 lookback 窗口内扫到的这 N 次 run，
      // 旧版据此下"生产库**从未**被这条链备份过"的结论＝把"窗口内没看到"说成"从来没发生过"
      // （同族教训：盲区不是零 / 未到期不是否证）。窗口外的历史本判据无从得知，就只能不写。
      const span = runs.length >= 2
        ? `${runs[runs.length - 1].createdAt?.slice(0, 10)} ~ ${runs[0].createdAt?.slice(0, 10)}`
        : String(runs[0].createdAt?.slice(0, 10))
      problems.push(
        `本判据可见的窗口（最近 ${runs.length} 次 run，${span}，lookback ${lookbackDays} 天）内`
        + `**没有任何一次**满足"导出步骤 success + artifact ≥ 1 + run success"`
        + ` ⇒ 窗口内没有任何一次备份产物可核对（窗口外是否曾成功，本判据看不见，不下结论）`
        + diagnoseSecrets(runs))
    }
  } else if (mode === 'backup' && Number.isFinite(nowMs)) {
    // 「最近一次真备份多久前」是**产物面**的断言；presence 的龄期归下面那条调度层断言管，
    // 两处各判一遍会让同一条红出两行、看着像两件事（第四十二轮归口教训）。
    const then = Date.parse(good.createdAt)
    if (!Number.isFinite(then)) problems.push(`成功 run 的时间戳解不出来：${JSON.stringify(good.createdAt)} ⇒ 无法证新鲜度，按不通过处理`)
    else {
      const ageDays = (nowMs - then) / 86400_000
      if (ageDays > maxAgeDays) problems.push(`最近一次真备份是 ${ageDays.toFixed(1)} 天前（阈值 ${maxAgeDays} 天）⇒ 链已停摆（cron 被改？workflow 被禁用？配额耗尽？）`)
    }
  }

  // 调度层断言：窗口内至少要有一次 scheduled run；且最近一次的龄期不得超过 2 个周期 + 1 天缓冲。
  // **presence 模式的龄期唯一出口就是这里**（第六十八轮）：它不认产物，所以阈值由**周期推导**
  // 而不是由 `LIVENESS_MAX_AGE_DAYS` 配置——一个事实只在一处判，也不留一处会被忽略的死配置。
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

  // 颜色从闸门降成**读数**（第六十八轮）——降成读数不等于不说，沉默的绿与沉默的红是同一种病。
  // 只在 presence 印：backup 面的"颜色"就是它自己的产物判据，此处数它的 run 会指错对象。
  if (mode === 'presence' && scheduled.length) {
    const byNewest = scheduled.slice().sort((a, b) => tOf(b) - tOf(a))
    let streak = 0
    for (const r of byNewest) { if (r.conclusion === 'success') break; streak++ }
    const head = byNewest[0]
    if (streak > 0) {
      warnings.push(`对侧 cron 到点在跑，但连着 ${streak}/${scheduled.length} 次不是 green`
        + `（最近 = run ${head.id} ${head.createdAt} conclusion=${head.conclusion ?? 'null'}）`
        + ' ⇒ 本步只证"有没有跑"，颜色归它自己的判据管；这条 WARN 是读数，不是豁免')
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
      artifacts: r.artifacts_count, steps: (r.steps || []), artifactNames: r.artifactNames,
    }))
  } catch (e) {
    console.error(`[liveness] BLOCKED 取不到 run 历史：${e instanceof Error ? e.message.split('\n')[0] : e} ⇒ 取不到不等于没问题`)
    process.exit(2)
  }
  // artifacts_count 在 list 接口里就有；缺失时逐个补（少一次"看不见就当 0"的假设）。
  // 第三十七轮再加一层：**有产物 ≠ 有备份**。加密出路上线后产物名分两种
  // （`d1-backup-<run>` 明文·私有仓 / `d1-backup-enc-<run>` 密文·非私有仓），
  // 名字不像备份产物的 run 不能算"备份过"（否则任何一次跑都会因附带 coverage 而变绿）。
  for (const r of runs) {
    if (typeof r.artifacts !== 'number' && !fixture) {
      try {
        const a = ghApi(`repos/${repo}/actions/runs/${r.id}/artifacts`)
        r.artifacts = a.total_count
        if (Number.isFinite(r.artifacts) && r.artifacts > 0) r.artifactNames = (a.artifacts || []).map((x) => x.name)
      } catch { r.artifacts = -1 }
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
  // 首行读数必须与本 mode 实际断言的东西同形：presence 不认产物，就不许印"新鲜度阈值"
  // （那是产物面的数，印出来会让人以为它在管，而它现在由周期推导）。
  console.log(`[liveness] mode=${mode} 窗口=${lookbackDays}天 周期=${cronPeriodDays}天 扫到 ${runs.length} 次 run；`
    + (mode === 'presence'
      ? `调度龄期容许 ≤${cronPeriodDays * 2 + 1} 天（周期×2+1 推导，本 mode 不判产物）`
      : `新鲜度阈值 ${process.env.LIVENESS_MAX_AGE_DAYS || 2} 天`)
    + `；豁免=${exempt ? '是' : '否'}`)
  for (const r of runs.slice(0, 5)) {
    const shape = (r.steps || []).filter((s) => /Export remote D1|Upload backup artifact/.test(s.name || ''))
      .map((s) => `${s.name}=${s.conclusion}`).join(' ')
    console.log(`  - run ${r.id} ${r.createdAt} ${r.conclusion} artifact=${r.artifactCount}${shape ? ` ｜ ${shape}` : ''}`)
  }
  for (const w of warnings) console.log(`[liveness] WARN ${w}`)
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error(mode === 'presence'
      // 旧句「这条 cron 没在按时跑（被禁用／改期／配额耗尽）」是**未被证据撑住的归因**：
      // 一手实况（run 37241500391）里对侧每夜都在跑、只是红，而本步已不再判颜色。
      // 具体红因由上面每行 ✗ 各自带着，这里不替它们下结论。
      ? '[liveness] FAIL ⇒ 对侧 cron 的调度层不成立（红因见上面逐行 ✗：到点没跑 = 被禁用/改期/配额；时间戳解不出 = 取数面问题）。本步不判它的颜色'
      : '[liveness] FAIL ⇒ 备份不可依赖。两条出路见 .github/workflows/d1-backup.yml 顶部注释；要显式接受"暂时不备份"就设仓库变量 BACKUP_SKIP_OK=true（会降为 WARN，但别再让它沉默）')
    process.exit(1)
  }
  // 输出必须与 mode 对齐（第四十三轮 R43-H1）：presence 模式**不要求产物**，
  // 却一直在印"最近一次可核对备份" —— 那是把没断言的东西说成断言过（判据匹配描述而不是行为）。
  // 第六十八轮再进一步：presence 连"成功"两个字都不印，因为它判的是**跑过**，颜色另起一行读数。
  console.log(mode === 'presence'
    ? `[liveness] OK 调度层存活：最近一条 scheduled run = run ${good.id}（${good.createdAt}，conclusion=${good.conclusion ?? 'null'}）——本步只证到点跑过，未证它绿`
    : `[liveness] OK 最近一次可核对备份：run ${good.id}（${good.createdAt}，artifact=${good.artifactCount}）`)
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main()
}
