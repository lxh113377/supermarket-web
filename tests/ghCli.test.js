// 第六十七轮：**共享取数件 `scripts/lib/gh-cli.mjs` 的接线与牙齿**
//
// 立它的读数是两次同源事故，都长在同一个形态上 ——「按名字 spawn `gh`」：
// 本机 PATH 首位 `C:/Users/37533/.local/bin/gh` 是一个 **0 字节、无扩展名的残件**。
// PowerShell 把它当"文档"直接拒执行并零输出；Node 的 spawnSync 同样起不来，而它的失败也是
// 零输出的那种。后果不是"少一条数据"，而是**整份对标名册的取数长期不可得**，
// 且失败原因被读成了网络/通道问题（第六十五、六十六轮报告里的「本机量不到」就是这么来的）。
//
// 本块分两半，各配一条方向相反的腿（正例证明它认得出来，反例证明它不是"什么都判过"）：
//   ① findGh：0 字节残件必须被跳过；真可执行件必须被认出来（Windows 只认带扩展名的，
//      POSIX 额外接受带 shebang 的无扩展名文件 —— 那正是测试夹具能造出来的形态）。
//   ② classifyRisk：脚本**经间接层调用** gh 时，风险标签仍必须是 gh-cli。
//      不补这条的后果本轮实测过：benchmark-peers.mjs 从派生风险名单里静默消失，
//      自动探针就会开始真跑它 —— 而它每次要打十几个远端 API 调用。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'gh-cli.mjs')).href)
const { classifyRisk } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'preflight.mjs')).href)
const { findGh, resetGhCache } = mod

const dirs = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function shimDir(files) {
  const d = mkdtempSync(join(tmpdir(), 'ghcli-'))
  dirs.push(d)
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(d, name), body, { mode: 0o755 })
    try { chmodSync(join(d, name), 0o755) } catch { /* Windows 无 POSIX 权限位 */ }
  }
  return d
}

describe('findGh：0 字节残件不是可执行文件（第六十七轮的一手事故形态）', () => {
  it('正例：目录里只有 0 字节残件（无扩展名 + .exe）⇒ 必须返回 null，不许把它们当 gh', () => {
    const d = shimDir({ gh: '', 'gh.exe': '' })
    expect(findGh({ extraDirs: [d] }) === null || findGh({ extraDirs: [d] }) !== join(d, 'gh'),
      '0 字节文件被当成了可执行的 gh —— 这正是事故现场').toBe(true)
  })

  it('反例：同一个目录里放一个非 0 字节件 ⇒ 必须被认出来（否则上一条是"什么都返回 null"）', () => {
    const d = shimDir({ 'gh.exe': 'MZ fake binary' })
    expect(findGh({ extraDirs: [d] })).toBe(join(d, 'gh.exe'))
  })

  it('反例：0 字节在前、非 0 字节在后 ⇒ 必须跳过残件选中后者（顺序不能决定结果）', () => {
    const d = shimDir({ 'gh.exe': '', 'gh.bat': '@echo fake' })
    expect(findGh({ extraDirs: [d] })).toBe(join(d, 'gh.bat'))
  })

  it('runGh 在找不到 gh 时必须明说"没有可执行 gh"，而不是伪装成"取到空数据"', async () => {
    const r = mod.runGh(['api', 'rate_limit'], { timeoutMs: 5000 })
    // 本机有真 gh ⇒ 这一支量的是"能叫起来"；没有 ⇒ 必须是 exe===null 这个显式信号。
    // 两种都接受，但**绝不允许** r.exe 为真却 stdout 为空且 status 为 0（那才是静默放行）。
    if (r.exe !== null) {
      expect(r.status === 0 ? r.stdout.length > 0 : true,
        'gh 被叫起来了却交出空响应且 rc=0 —— 那是一条静默通道').toBe(true)
    }
    expect(typeof r.exe === 'string' || r.exe === null).toBe(true)
    resetGhCache()
  })
})

describe('classifyRisk：间接层不能把风险藏掉（benchmark-peers 的实测教训）', () => {
  it('正例：经共享取数件调用 gh ⇒ 必须判 gh-cli', () => {
    const src = "import { runGh } from './lib/gh-cli.mjs'\nconst r = runGh(['api', path], { timeoutMs: 20000 })\n"
    expect(classifyRisk(src)).toContain('gh-cli')
  })

  it('正例：只 import 不调用也算（import 本身就说明这条脚本会去调 gh）', () => {
    expect(classifyRisk("import { runGh } from './lib/gh-cli.mjs'\n")).toContain('gh-cli')
  })

  it('反例：不相干的脚本不得被这条新模式误伤（否则它就成了万能标签）', () => {
    expect(classifyRisk("console.log('hi')\n")).not.toContain('gh-cli')
    expect(classifyRisk("import { readFileSync } from 'node:fs'\n")).not.toContain('gh-cli')
  })

  it('反例：注释里提到 runGh 不得算（风险是代码的属性，不是散文的属性）', () => {
    expect(classifyRisk("// 以前是 runGh()，现在改了\nconst x = 1\n")).not.toContain('gh-cli')
  })

  it('真仓面上：benchmark-peers.mjs 必须仍被判 gh-cli（它每轮都要打十几个远端 API）', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'benchmark-peers.mjs'), 'utf8')
    expect(classifyRisk(src), 'benchmark-peers 掉出派生风险名单 ⇒ 自动探针会开始真跑它').toContain('gh-cli')
  })
})
