// @vitest-environment node
/**
 * 门禁脚本自身的常驻夹具用例（第九轮 R9-H1 的第二半）
 *
 * 对标实测到的两件：`vendure` 给 CI 脚本 `dependency-impact.js` 配了 `dependency-impact.test.js`
 * （含 mock 掉 `gh` 二进制 + 注入 HTTP 失败），`saleor` 的 semgrep 每条规则同时带
 * 「必须命中(ruleid)」与「必须不命中(ok)」两类样本。本仓第八轮做过同类事，但那是
 * **一次性变异脚本、跑完即弃** ⇒ 判据退化无人知晓。这里把它变成常驻。
 *
 * 每条门禁都必须有两侧：①  planted 违规 → 必须红；② 干净输入 → 必须不红（防"永远红的判据"
 * 被当成噪音绕过，也防"永远不红的判据"根本什么都没看）。
 *
 * 夹具仓一律建在 `os.tmpdir()` 下（受管根禁落临时产物），afterAll 清理。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const SCAN = join(REPO, 'scripts', 'scan-secrets.mjs')
const CHANGELOG_GATE = join(REPO, 'scripts', 'check-changelog.mjs')
const DOCS = join(REPO, 'scripts', 'check-doc-consistency.mjs')
const CASES = join(REPO, 'scripts', 'check-case-collision.mjs')

const dirs: string[] = []

function freshGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'smgate-'))
  dirs.push(dir)
  const git = (...a: string[]) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  }
  git('init', '-q', '.')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'fixture')
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'chore: fixture base')
  return dir
}

function commitIn(dir: string, files: Record<string, string>, msg: string) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  const r = spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git add: ${r.stderr}`)
  const c = spawnSync('git', ['commit', '-q', '-m', msg], { cwd: dir, encoding: 'utf8' })
  if (c.status !== 0) throw new Error(`git commit: ${c.stderr}`)
}

/**
 * 跑门禁脚本于夹具仓。
 *
 * 关键细节（本文件首次跑就抓到）：这些脚本按**自身文件位置**锚仓库根
 * （`ROOT = dirname(import.meta.url)/..`），所以只改 cwd 是骗不过去的 ——
 * 直接把真仓脚本 spawn 到临时仓，扫的仍是真仓（症状：输出"已跟踪 530"）。
 * ⇒ 必须把脚本复制进夹具仓的 scripts/ 再跑，判据才真的作用在夹具上。
 */
function runGate(script: string, cwd: string) {
  const local = join(cwd, 'scripts')
  mkdirSync(local, { recursive: true })
  const target = join(local, script.split(/[\\/]/).pop()!)
  writeFileSync(target, readFileSync(script, 'utf8'))
  const r = spawnSync(process.execPath, [target], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: '', GITHUB_EVENT_BEFORE: '' },
  })
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('scan-secrets 门禁：必须能红，也必须能不红', () => {
  it('植入 AWS 形态密钥 → 必须红（exit 1 且点名命中项）', () => {
    const dir = freshGitRepo()
    // 静态源码里**不得**留完整的 AKIA+20 位字面量：本仓 pre-commit 与 verify 的 scan-secrets
    // 会把它当真密钥拦下（实测拦过），那正是它该做的事。⇒ 运行时再拼成完整形态写进夹具仓。
    const akid = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
    commitIn(dir, { 'src/config.js': `export const K = "${akid}";\n` }, 'feat: plant secret')
    const r = runGate(SCAN, dir)
    expect(r.status, `植入密钥却没拦住，输出：${r.out}`).toBe(1)
    expect(r.out.toLowerCase()).toContain('aws')
  })

  it('干净仓库 → 必须不红（防"永远红的判据"被当噪音绕过）', () => {
    const dir = freshGitRepo()
    commitIn(dir, { 'src/ok.js': 'export const name = "supermarket";\n' }, 'feat: clean file')
    const r = runGate(SCAN, dir)
    expect(r.status, `干净仓被误判，输出：${r.out}`).toBe(0)
  })

  it('占位符样式（your-secret-here 类）→ 不得误伤', () => {
    const dir = freshGitRepo()
    commitIn(dir, { '.env.example': 'API_KEY=your-secret-here\n' }, 'docs: placeholder env example')
    const r = runGate(SCAN, dir)
    expect(r.status, `占位符被误判为密钥，输出：${r.out}`).toBe(0)
  })
})

describe('CHANGELOG 门禁：改了产品代码必须有记录', () => {
  it('只改 src、无 CHANGELOG 条目 → 必须红', () => {
    const dir = freshGitRepo()
    commitIn(dir, { 'src/new.ts': 'export const x = 1\n' }, 'feat: code without changelog')
    const r = runGate(CHANGELOG_GATE, dir)
    expect(r.status, `无变更记录却放行，输出：${r.out}`).toBe(1)
  })

  it('src + CHANGELOG 同提交 → 必须绿，且基线回落到 HEAD~1 有留痕', () => {
    const dir = freshGitRepo()
    writeFileSync(join(dir, 'CHANGELOG.md'), '# 更新日志\n\n## [未发布]\n\n- 加了一条记录\n')
    spawnSync('git', ['add', '-A'], { cwd: dir })
    spawnSync('git', ['commit', '-q', '-m', 'docs: changelog skeleton'], { cwd: dir })
    commitIn(dir, { 'src/new.ts': 'export const x = 1\n', 'CHANGELOG.md': '# 更新日志\n\n## [未发布]\n\n- 加了产品改动对应的记录\n' }, 'feat: code with changelog')
    const r = runGate(CHANGELOG_GATE, dir)
    expect(r.out).toContain('HEAD~1')
    expect(r.status, `带记录仍被拦，输出：${r.out}`).toBe(0)
  })

  it('push 区间模式：before..HEAD 时，把 src 改动藏在末位 docs 提交后也必须红', () => {
    // 第八轮 M1 修的洞：一次 push 多提交，旧实现只校验末位那个 ⇒ 纯 docs 末位提交能免检。
    const dir = freshGitRepo()
    commitIn(dir, { 'src/a.ts': 'export const a = 1\n' }, 'feat: real change without changelog')
    commitIn(dir, { 'docs/only.md': '# note\n' }, 'docs: innocent last commit hiding it')
    const before = spawnSync('git', ['rev-parse', 'HEAD~2'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const r = spawnSync(process.execPath, [CHANGELOG_GATE], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, GITHUB_BASE_REF: '', GITHUB_EVENT_BEFORE: before },
    })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    expect(out).toContain('before..HEAD')
    expect(r.status, `整段区间里有 src 改动却放行（洞没修掉），输出：${out}`).toBe(1)
  })
})

describe('文档一致性与大小写门禁：环境不满足必须响亮而非静默', () => {
  it('缺 docs/api-contract.json 时文档门禁 → exit 2 并给出重生命令，不得静默 PASS', () => {
    const dir = freshGitRepo()
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    mkdirSync(join(dir, 'tests'), { recursive: true })
    const r = runGate(DOCS, dir)
    expect(r.status, `源缺失却当通过（零输入记 PASS 是禁止的），输出：${r.out}`).toBe(2)
  })

  it('索引内大小写互撞 → 必须红（Windows 上会静默覆盖同名异 Case 文件）', () => {
    const dir = freshGitRepo()
    // 配对必须两条都在索引里：只塞一条异名 Case 是**假反例**（永远不红）。
    commitIn(dir, { 'foo.test.ts': 'export const t = 1\n' }, 'test: lower-case entry')
    const sha = spawnSync('git', ['rev-parse', 'HEAD:foo.test.ts'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    // update-index 直接写第二条索引项，绕开大小写不敏感文件系统"造不出两个文件"的死结
    const add = spawnSync('git', ['update-index', '--add', '--cacheinfo', `100644,${sha},Foo.test.ts`], { cwd: dir, encoding: 'utf8' })
    expect(add.status, add.stderr).toBe(0)
    const r = runGate(CASES, dir)
    expect(r.status, `索引内互撞没拦住，输出：${r.out}`).toBe(1)
    expect(r.out).toContain('Foo.test.ts')
    expect(r.out).toContain('foo.test.ts')
  })

  it('正向对照：同一夹具仓去掉第二条索引项 → 必须不红', () => {
    const dir = freshGitRepo()
    commitIn(dir, { 'foo.test.ts': 'export const t = 1\n' }, 'test: single entry only')
    const r = runGate(CASES, dir)
    expect(r.status, `只有一条却判互撞（误伤），输出：${r.out}`).toBe(0)
  })
})

describe('本仓真实状态的正向基线（夹具之外的对照）', () => {
  it('对本仓跑大小写门禁 → 必须 0（否则说明夹具与真实判据不同源）', () => {
    // 注意：这里**不能**用 runGate —— 它会把脚本复制进目标仓的 scripts/，
    // 对真仓跑就等于往真仓里写文件。真仓只允许原地跑自己那份脚本。
    const r = spawnSync(process.execPath, [CASES], { cwd: REPO, encoding: 'utf8' })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    expect(r.status, out).toBe(0)
    expect(out).toContain('无大小写冲突')
  })
})
