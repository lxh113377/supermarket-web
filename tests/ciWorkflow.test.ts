// @vitest-environment node
/**
 * CI 门禁链自身的常驻反向用例（第九轮 R9-H1）
 *
 * 对标三件实测到的做法：
 * - `microfeed` `tests/unit/ci-workflow.test.ts`：把工作流文件当被测对象，断言 step 顺序与
 *   secret 白名单**全等**，并 `not.toContain` 危险写法；
 * - `vendure` `.github/workflows/scripts/dependency-impact.test.js`：门禁脚本自带测试（含 mock 失败注入）；
 * - `saleor` `.semgrep/`：每条规则同时带「必须命中」与「必须不命中（`# ok:`）」两类样本。
 *
 * 为什么本仓必须有它（不是理论洁癖）：`deploy.needs` 从 09-24 起在 ci.yml 注释与 CHANGELOG 里
 * 被写成"具备阻断力"，而**实际 needs 只有 build-and-test**，`e2e` 红了照常部署，直到防线轮才接上
 * ——「注释说阻断 ≠ 真阻断」是本仓两次踩过的假安全感。这条测试把它钉成机器判据。
 *
 * 反例（已实跑，见第八轮交付记录 / 本轮 CHANGELOG）：删掉 needs 里任一项、把某处 uses 改回标签、
 * 或改掉一个必需 step 名 ⇒ 本文件对应用例变红。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WF_DIR = join(__dirname, '..', '.github', 'workflows')
/**
 * 行尾归一化（不是可选项）：本机工作树是 CRLF（git autocrlf 会把 LF 换成 CRLF 落盘），
 * 而 ubuntu runner 上是 LF。行锚定正则不归一就会**本地红 / CI 绿**，
 * 那是比缺失判据更糟的形态（一台会误报的机器）。
 */
const readWorkflow = (name: string) => readFileSync(join(WF_DIR, name), 'utf8').replace(/\r\n/g, '\n')
const ci = readWorkflow('ci.yml')
const allWorkflows = readdirSync(WF_DIR).map((f) => [f, readWorkflow(f)] as const)


/** 取 job 名列表（jobs: 下两空格缩进的键） */
function jobNames(text: string): string[] {
  const start = text.indexOf('\njobs:\n')
  if (start < 0) return []
  const body = text.slice(start + 7)
  const names: string[] = []
  for (const line of body.split('\n')) {
    const m = /^  ([a-zA-Z0-9_-]+):[ \t]*(#.*)?$/.exec(line)
    if (m) names.push(m[1])
  }
  return names
}

/** deploy job 的 needs 列表 */
function deployNeeds(text: string): string[] {
  const m = /\n  deploy:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|$)/.exec(text)
  if (!m) throw new Error('找不到 deploy job')
  const n = /needs:\s*\[([^\]]*)\]/.exec(m[1])
  if (!n) throw new Error('deploy job 没有 needs —— 即"红了也照常部署"')
  return n[1].split(',').map((s) => s.trim()).filter(Boolean)
}

const JOBS = jobNames(ci)
const NEEDS = deployNeeds(ci)

describe('deploy 的阻断链（注释说阻断不算，看 needs）', () => {
  it('CI 至少含这五个 job', () => {
    expect(new Set(JOBS)).toEqual(
      new Set(['build-and-test', 'e2e', 'e2e-cloud-stub', 'visual', 'deploy']),
    )
  })

  it('deploy.needs 必须覆盖全部判据 job（缺一即"判据假安全感"）', () => {
    const gates = JOBS.filter((j) => j !== 'deploy')
    const missing = gates.filter((j) => !NEEDS.includes(j))
    expect(missing, `这些判据 job 红了也照常部署：${missing.join(', ')}`).toEqual([])
    expect(NEEDS.length).toBe(gates.length)
  })

  it('其余 workflow 是独立链（不经 deploy），必须显式声明，勿误当阻断门禁', () => {
    const standalone = allWorkflows
      .filter(([f]) => f !== 'ci.yml')
      .map(([f, t]) => [f, /needs:/.test(t)] as const)
    expect(standalone.every(([, hasNeeds]) => !hasNeeds),
      'standalone workflow 里出现了 needs —— 说明有人把它当阻断链，需同步本测试').toBe(true)
  })
})

describe('供应链卫生：actions 全部钉到提交 SHA', () => {
  it('四个 workflow 里每个 uses: 都是 40 位十六进制', () => {
    const offenders: string[] = []
    for (const [file, text] of allWorkflows) {
      for (const line of text.split('\n')) {
        const m = /^\s*-?\s*uses:\s*(\S+)/.exec(line)
        if (!m) continue
        const ref = m[1].replace(/['"]/g, '')
        if (!/@[0-9a-f]{40}$/.test(ref)) offenders.push(`${file}: ${ref}`)
      }
    }
    expect(offenders, `未钉 SHA 的 action：${offenders.join(' | ')}`).toEqual([])
  })

  it('钉 SHA 的行必须同时保留可读版本注释（便于人工复核升级）', () => {
    const pinned = ci.split('\n').filter((l) => /uses:\s*\S+@[0-9a-f]{40}/.test(l))
    expect(pinned.length).toBeGreaterThanOrEqual(10)
    const uncommented = pinned.filter((l) => !/#\s*v?\d/.test(l))
    expect(uncommented, `缺版本注释的钉版行：${uncommented.join(' | ')}`).toEqual([])
  })
})

describe('密钥卫生：workflow 里不得出现明文密钥值', () => {
  const SECRET_KEY_RE = /(ADMIN_KEY|API_KEY|_TOKEN|SECRET|PASSWORD)\s*:\s*['"]?([A-Za-z0-9][A-Za-z0-9+/_=-]{7,})/g

  it('命中"密钥名: 长值"的行只能是 ${{ secrets.* }} 或已登记的公开量', () => {
    const ALLOW_PUBLIC_VALUES = /^(04b1466b2606b678a332fe6f26aa87ec)$/
    const bad: string[] = []
    for (const [file, text] of allWorkflows) {
      for (const line of text.split('\n')) {
        if (/secrets\./.test(line) || /^\s*#/.test(line)) continue
        for (const m of line.matchAll(SECRET_KEY_RE)) {
          if (!ALLOW_PUBLIC_VALUES.test(m[2])) bad.push(`${file}: ${m[1]}=<非 secrets 引用>`)
        }
      }
    }
    expect(bad, `疑似明文密钥：${bad.join(' | ')}`).toEqual([])
  })

  it('反向断言：workflow 里出现的 ADMIN_KEY 一律走 secrets 注入', () => {
    const raw = allWorkflows.filter(([, t]) => /ADMIN_KEY/.test(t)).map(([f]) => f)
    expect(raw, '本仓 workflow 不该直接引用 ADMIN_KEY（密钥只在 Cloudflare Pages secret 与 .dev.vars）')
      .toEqual([])
  })
})

describe('关键 step 存在性（改名即红，防"门禁静默消失"）', () => {
  const REQUIRED_STEPS = [
    'Dependency audit (npm audit, high+)',
    'Secret scan',
    'File-name case collision check',
    'Env var registry gate (code vs docs/env-vars.md)',
    'Import cycle check',
    'API contract drift check',
    'Doc facts consistency gate',
    'Schema drift check (migrations vs schema.sql)',
    'Production license gate',
    'CHANGELOG entry gate',
    'Bundle size budget (gzip, first-load)',
    'Pages Functions deployable-artifact check (compile, no deploy)',
    'Backend contract verify (node:sqlite mock D1)',
  ]
  const steps = (text: string) => [...text.matchAll(/-\s*name:\s*(.+?)\s*$/gm)].map((m) => m[1])

  it('build-and-test 里这些 step 一个都不能少', () => {
    const body = /\n  build-and-test:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|$)/.exec(ci)?.[1] ?? ''
    const have = steps(body)
    const missing = REQUIRED_STEPS.filter((s) => !have.includes(s))
    expect(missing, `CI 里缺失 step：${missing.join(' | ')}`).toEqual([])
  })

  it('deploy 后置：本端冒烟与回滚两道都得在（缺一即"发完不看"）', () => {
    const body = /\n  deploy:\n([\s\S]*?)$/.exec(ci)?.[1] ?? ''
    const have = steps(body)
    for (const need of ['Deploy to Cloudflare Pages', 'Smoke test deployed API',
      'Rollback to previous deployment (smoke failed)', 'Rollback failed (manual intervention required)']) {
      expect(have, `deploy job 缺 step：${need}`).toContain(need)
    }
    // 第九轮实测教训（反向钉住）：双端一致性判据**不许**搬回 deploy job ——
    // 顾客端链路与本 job 并行，放这里必然把"还没轮到另一端"误判成故障（CI 首跑实证）。
    expect(body, '双端一致性判据又回到 deploy job 了，会被并行时序误报').not.toContain('verify:parity')
  })

  it('双端一致性判据住在独立 workflow，且落在 CI 完成之后、只报警不回滚', () => {
    const rp = readWorkflow('release-parity.yml')
    const body = /\njobs:\n([\s\S]*)$/.exec(rp)?.[1] ?? ''
    const have = steps(body)
    expect(have).toContain('Verify two-end release parity')
    expect(rp).toContain("workflows: ['CI']")
    expect(rp).toContain('types: [completed]')
    // 只有 CI 绿才核，否则两端本就可能不同批，报警会淹掉真信号
    expect(rp).toContain("github.event.workflow_run.conclusion == 'success'")
    // 基线取发布提交的时刻，而不是"本步开始时刻"——后者会把上一批构建误判成已刷新
    expect(rp).toContain('--format=%ct')
    expect(rp).toContain('PARITY_AFTER_TS:')
    // 有 checkout 才能用 git（首稿就漏了这一步）。只断言"首步是 Checkout"这一条不变量——
    // 曾写过一条"run: git ... 之前必须有 name: Checkout"的正则，无法判断位置 ⇒ 把合法形态也判红，
    // 属"过严的判据与缺失的判据一样有害"，已删。
    expect(have[0], 'release-parity 第一步必须是 checkout，否则后续 git 命令无从执行').toBe('Checkout')
    // 只报警不回滚
    expect(body).not.toContain('rollback')
  })

  it('CHANGELOG 门禁必须拿到 push 区间（GITHUB_EVENT_BEFORE），否则退回单提交校验', () => {
    const block = /\n\s*-\s*name:\s*CHANGELOG entry gate\n([\s\S]*?)(?=\n\s*-\s*name:|\n\n)/.exec(ci)?.[1] ?? ''
    expect(block).toContain('GITHUB_EVENT_BEFORE')
    expect(block).toContain('github.event.before')
  })

  it('Build step 必须烘焙线上端点（坑 27 防线，两处 Build 都要）', () => {
    const blocks = ci.split('\n').join('\n')
    const builds = [...blocks.matchAll(/-\s*name:\s*Build[\s\S]*?\n(?=\s{6}-\s*name:|\s{4}\S)/g)]
    expect(builds.length).toBeGreaterThanOrEqual(1)
    for (const b of builds) {
      expect(b[0]).toContain('VITE_CB_API_BASE')
      expect(b[0]).toContain('VITE_CB_PUBLIC_API_BASE')
    }
  })
})

describe('.github 静态件结构（新加的模板也得有人守，否则"有模板"只是感觉）', () => {
  const ISSUE_DIR = join(WF_DIR, '..', 'ISSUE_TEMPLATE')

  /** 轻量结构判据：制表符、name 头、每个 `- type:` 后必须紧跟同层 attributes */
  function yamlProblems(name: string, text: string): string[] {
    const bad: string[] = []
    if (/\t/.test(text)) bad.push(`${name}: 含制表符缩进（YAML 禁止）`)
    if (!/^name:\s*\S/m.test(text)) bad.push(`${name}: 缺 name: 头（GitHub 会静默忽略该表单）`)
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)-\s+type:\s*\S/.exec(lines[i])
      if (!m) continue
      const indent = m[1]
      const proper = new RegExp(`^${indent} {2}attributes:`)
      const wrongIndent = new RegExp(`^${indent}(?: {1,1}| {3,})attributes:`)
      // 块体范围：到下一个同级 `- ` 条目或整体 dedent 为止
      let hasAttributes = false
      let misplacedAt = 0
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (new RegExp(`^${indent}-\\s`).test(l)) break
        if (!/^\s/.test(l) && l.trim() !== '') break
        if (proper.test(l)) { hasAttributes = true; break }
        if (wrongIndent.test(l) && !misplacedAt) misplacedAt = j + 1
      }
      if (!hasAttributes) {
        bad.push(misplacedAt
          ? `${name}: 第 ${misplacedAt} 行 attributes: 缩进不对（应比 - type: 多两格；GitHub 会静默忽略该条目）`
          : `${name}: 第 ${i + 1} 行的 - type: 块里没有 attributes: 条目`)
      }
    }
    return bad
  }

  const forms = readdirSync(ISSUE_DIR).filter((f) => /^(bug_report|feature_request)\.yml$/.test(f))

  it('至少有两个表单，且逐个通过结构判据', () => {
    expect(forms.length).toBeGreaterThanOrEqual(2)
    const problems = forms.flatMap((f) => yamlProblems(f, readFileSync(join(ISSUE_DIR, f), 'utf8')))
    expect(problems, problems.join(' | ')).toEqual([])
  })

  it('config.yml 关掉空白 issue 并给出安全通道（SECURITY.md 的入口）', () => {
    const cfg = readFileSync(join(ISSUE_DIR, 'config.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(cfg).toContain('blank_issues_enabled: false')
    expect(cfg).toContain('security/advisories/new')
  })

  it('判据自身可证伪：把写坏过的缩进喂进去必须报错；而合法顺序（type→id→attributes）不得报错', () => {
    // 反例＝本仓 feature 模板首稿真犯过的错（attributes 多缩了两格、value 反而 dedent）
    const broken = 'name: X\nbody:\n  - type: markdown\n      attributes:\n    value: |\n      hi\n'
    expect(yamlProblems('broken', broken).length, '缩进写坏却没报 → 判据失效').toBeGreaterThan(0)
    // 正例 1：GitHub issue-form 的合法顺序是 type → id → attributes（第一版判据要求紧挨着，
    // 把自己人全判红了 —— 过严的判据与缺失的判据一样有害，这里钉住）
    const legalWithId = 'name: X\nbody:\n  - type: textarea\n    id: what\n    attributes:\n      label: 现象\n'
    expect(yamlProblems('legalWithId', legalWithId)).toEqual([])
    // 正例 2：markdown 块（无 id）
    const fixed = 'name: X\nbody:\n  - type: markdown\n    attributes:\n      value: |\n        hi\n'
    expect(yamlProblems('fixed', fixed)).toEqual([])
    // 反例 2：整块缺 attributes
    const missing = 'name: X\nbody:\n  - type: textarea\n    id: what\n    label: 现象\n'
    expect(yamlProblems('missing', missing).length).toBeGreaterThan(0)
  })
})

describe('权限最小化（OpenSSF token-permissions 自查）', () => {
  it('每个 workflow 顶层都声明 permissions 且不含写权限（deploy 需要的除外）', () => {
    for (const [file, text] of allWorkflows) {
      const m = /^permissions:\n((?:[ \t]+\w+:[ \t]+\w+\n?)+)/m.exec(text)
      expect(m, `${file} 缺顶层 permissions`).toBeTruthy()
      const block = m![1]
      expect(block, `${file} 给了写权限`).not.toMatch(/:\s*write/)
      expect(block).toMatch(/contents:\s*read/)
    }
  })

  it('并发组：能跑 PR／多 ref 的 workflow，cancel-in-progress 时必须按 ref 分组', () => {
    // 真不变量的来源是实测坑 #1：ci.yml 曾用固定组名，导致 dependabot 多 PR 与 main run 互砍（5/5 全卡 unstable）。
    // 但"固定组"本身不总是缺陷：dispatch.yml 只 on: push: branches:[main]（PR 根本不触发它），
    // 固定组 + cancel-in-progress 是**故意的去重**（连续 push 只 dispatch 一次）；uptime.yml 是
    // 固定组 + cancel-in-progress: false（排队不砍）。⇒ 判据只对"可能多 ref 并发"的 workflow 生效。
    for (const [file, text] of allWorkflows) {
      if (!/concurrency:/.test(text)) continue
      const cancels = /cancel-in-progress:\s*true/.test(text)
      const multiRef = /pull_request|push:[\s\S]*?branches:[^\n]*\[[^\]]*,/.test(text)
        || /^\s*branches:\s*\[[^\]]*,/m.test(text)
      const groupIsRefScoped = /group:.*github\.ref/.test(text)
      if (cancels && multiRef) {
        expect(groupIsRefScoped, `${file} 用固定组名 + cancel-in-progress，PR 与 main 会互砍`).toBe(true)
      }
    }
    // 反向自证：ci.yml 必须落在"受本规则约束"的集合里，否则这条断言会退化成空转真
    expect(/pull_request/.test(ci), 'ci.yml 不再响应 pull_request，本判据的分母已失效，须同步修订').toBe(true)
    expect(/group:.*github\.ref/.test(ci)).toBe(true)
  })
})

/**
 * 模板注入自查（第十轮 R10-M1）——zizmor 最高价值那条规则的零依赖替代。
 * 规则形状照 zizmor `template-injection`：`run:` 块里插值**不可信上下文**
 * （github.event.* / github.head_ref / github.actor 等，PR 标题/分支名由外人控制）
 * 即等于把字符串塞进 shell 执行；正确写法是先 `env:` 映射，脚本里只引 `$VAR`。
 * 装 zizmor 要多一个 job + 一堆 `# zizmor: ignore` 注释税，本仓已全量 SHA pin，
 * 只剩这一类真实风险 ⇒ 用 15 行自查挡住，不起新依赖。
 */
const UNTRUSTED = /github\.(event|head_ref|actor|triggering_actor)\b/

function interpolationInsideRunBlocks(text: string): string[] {
  const lines = text.split('\n')
  const hits: string[] = []
  let inRun = false
  let runIndent = 0
  lines.forEach((line, i) => {
    const t = line.trim()
    const indent = line.length - line.trimStart().length
    if (inRun) {
      if (t !== '' && indent <= runIndent) inRun = false
    }
    if (!inRun) {
      // YAML 里 step 既可能写成 `run: |` 独占行，也可能写成 `- run: echo ...` 列表项同行
      const opener = /^(-\s+)?run:\s*[|>][-+]?\s*$/.exec(t)
      if (opener) {
        inRun = true
        runIndent = indent
        return
      }
      const inline = /^(-\s+)?run:\s*(.+)$/.exec(t)
      if (inline && /\$\{\{/.test(inline[2]) && UNTRUSTED.test(inline[2])) {
        hits.push(`第 ${i + 1} 行：内联 run 直接插值不可信上下文`)
      }
      return
    }
    if (/\$\{\{/.test(line) && UNTRUSTED.test(line)) {
      hits.push(`第 ${i + 1} 行：run 块内插值不可信上下文 ⇒ 改走 env:`)
    }
  })
  return hits
}

describe('workflow 模板注入自查（run 块不得插值不可信上下文）', () => {
  it('反例夹具必须被抓到（否则本判据恒绿=没测）', () => {
    const bad = [
      'jobs:', '  a:', '    steps:', '      - name: 打印 PR 标题',
      '        run: |', '          echo ${{ github.event.pull_request.title }}',
    ].join('\n')
    expect(interpolationInsideRunBlocks(bad)).toHaveLength(1)
    const badInline = ['jobs:', '  a:', '    steps:', '      - run: echo ${{ github.head_ref }}'].join('\n')
    expect(interpolationInsideRunBlocks(badInline)).toHaveLength(1)
  })

  it('正例夹具不得误伤：env: 映射 + 脚本引 $VAR 是推荐写法', () => {
    const good = [
      'jobs:', '  a:', '    steps:', '      - name: 打印 PR 标题',
      '        env:', '          TITLE: ${{ github.event.pull_request.title }}',
      '        run: |', '          echo "$TITLE"', '          echo "done ${{ env.TITLE }}"',
    ].join('\n')
    expect(interpolationInsideRunBlocks(good)).toEqual([])
  })

  it('块外注释里的 ${{ github.event.* }} 不算（只有 run 块才进 shell）', () => {
    const commentOnly = [
      'jobs:', '  a:', '    # 例：${{ github.event.pull_request.title }} 只写在注释里',
      '    steps:', '      - run: echo hi',
    ].join('\n')
    expect(interpolationInsideRunBlocks(commentOnly)).toEqual([])
  })

  it('真实仓 4 条 workflow 全部干净', () => {
    for (const [file, text] of allWorkflows) {
      expect(interpolationInsideRunBlocks(text), `${file} 有 run 块插值不可信上下文`).toEqual([])
    }
    // 反向钉：ci.yml/release-parity 确实在用 github.event.*，只是用法正确；
    // 若哪天不再使用，上面的断言就退化成空转真 ⇒ 这里显式要求分母非空。
    expect(/github\.event/.test(ci), 'ci.yml 已不再使用 github.event.*，请同步修订本判据的分母').toBe(true)
    const parity = readWorkflow('release-parity.yml')
    expect(/github\.event\.workflow_run/.test(parity)).toBe(true)
    expect(/env:\s*\r?\n\s+GITHUB_HEAD_SHA:/.test(parity), 'release-parity 的 head_sha 必须留在 env: 映射里').toBe(true)
  })
})

/**
 * workflow 排版骨架自查（第十轮：我自己把新 job 插到 `jobs:` 之外造成的）。
 * 症状最难发现也最致命：GitHub 直接一个 job 都不排（0 job、workflow conclusion=failure），
 * 而 `gh pr checks` 上看不到任何 step 日志，只能从 run 的 jobs 数组为空反推。
 * 两条最小不变量就够挡住这一类：① 顶层键必须是 Actions 合法字段；② 任何 `runs-on:`
 * 必须出现在顶层 `jobs:` 之后（否则那个 job 不在 jobs 里）。
 */
const TOP_LEVEL_KEYS = new Set(['name', 'on', 'permissions', 'concurrency', 'env', 'defaults', 'jobs', 'run-name', 'timeout-minutes'])

function workflowLayoutProblems(text: string): string[] {
  const lines = text.split('\n')
  const problems: string[] = []
  let jobsAt = -1
  lines.forEach((l, i) => { if (l === 'jobs:') jobsAt = i })
  lines.forEach((l, i) => {
    const top = /^([A-Za-z][\w-]*):\s*$/.exec(l)
    if (top && !TOP_LEVEL_KEYS.has(top[1])) problems.push(`第 ${i + 1} 行：顶层键 ${top[1]}: 不是 Actions 合法字段`)
    if (/^\s+runs-on:/.test(l) && (jobsAt < 0 || i < jobsAt)) {
      problems.push(`第 ${i + 1} 行：runs-on 出现在 jobs: 之前 ⇒ 该 job 根本不会被排出来`)
    }
  })
  return problems
}

describe('workflow 排版骨架（job 必须在 jobs: 里，顶层键必须合法）', () => {
  it('反例夹具必须被抓到：把 job 块写在 jobs: 之前', () => {
    const bad = [
      'name: X', 'permissions:', '  contents: read', 'jobz:', '  extra:',
      '    runs-on: ubuntu-latest', 'jobs:', '  real:', '    runs-on: ubuntu-latest',
    ].join('\n')
    const hits = workflowLayoutProblems(bad)
    expect(hits.some((h) => h.includes('runs-on 出现在 jobs: 之前'))).toBe(true)
    expect(hits.some((h) => h.includes('顶层键 jobz:'))).toBe(true)
  })
  it('正例夹具不得误伤', () => {
    const good = ['name: X', 'on: push', 'permissions:', '  contents: read', 'jobs:',
      '  a:', '    runs-on: ubuntu-latest'].join('\n')
    expect(workflowLayoutProblems(good)).toEqual([])
  })
  it('本仓 4 条 workflow 全部合格（含 dispatch.yml，它正是这次的案发现场）', () => {
    for (const [file, text] of allWorkflows) {
      expect(workflowLayoutProblems(text), `${file} 排版不合法`).toEqual([])
    }
    // 反向钉：分母必须真的含 dispatch.yml，否则哪天它不被读也"全绿"
    expect(allWorkflows.map(([f]) => f)).toContain('dispatch.yml')
  })
})
