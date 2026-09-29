// 第五十七轮：CI 状态脚本的凭据泄漏回归件。
// 一手事实：本轮跑 `node scripts/ci-status.mjs` 遇一次代理抖动，execFileSync 失败时 Node 把整条命令
// 连 argv 一起写进 error.message，于是 `-H "Authorization: Bearer ghp_…"` 的**明文 PAT 落到终端与对话里**。
//
// 本件的形状是"对照 + 被测"两条腿，缺一不可：
//   腿⓪（机制对照）用**老办法**（token 进 argv）跑一次注定失败的 curl，断言假 token **确实出现在**
//        error.message 里 —— 这一条证明"泄漏面在本机/CI 上可观察"。它若红，下面那条"没出现"就是空跑。
//   腿①（被测件）  用同样的必死代理跑 ci-status.mjs，断言假 token **不在**它的任何输出里。
// 假 token 由临时 `git` 垫片注入，不碰真凭据管理器；全程只断言"在/不在"，不打印值。
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'ci-status.mjs')
const FAKE = 'ghp_FAKEONLYforregtest000000000000000000'   // 形状像 PAT，内容是编的
const DEAD = 'http://127.0.0.1:9'                          // discard 端口：curl 必失败，且不碰网络
const dirs = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function shimDir() {
  const d = mkdtempSync(join(tmpdir(), 'cishim-'))
  dirs.push(d)
  const sh = '#!/bin/sh\nif [ "$1" = "credential" ]; then printf "protocol=https\\nhost=github.com\\nusername=shim\\npassword='
    + FAKE + '\\n"; exit 0; fi\nexit 0\n'
  writeFileSync(join(d, 'git'), sh, { mode: 0o755 })
  try { chmodSync(join(d, 'git'), 0o755) } catch { /* Windows：MSYS 按 shebang 处理 */ }
  return d
}
const SEP = process.env.COMPUTERNAME ? ';' : ':'
// 本件 spawn 的是 CLI（带 timeout）⇒ 按本仓规矩接 assertCliRan：status===null（超时/SIGTERM）不得
// 被当成"脚本说了什么"继续做内容断言（第五十五轮立的守卫，由 verify:cli-legs 盯着欠账上限）。
const runScript = (shim) => assertCliRan(spawnSync(process.execPath, [SCRIPT, '--limit=1', '--proxy=' + DEAD], {
  encoding: 'utf8', cwd: REPO, timeout: 120_000,
  env: { ...process.env, PATH: shim + SEP + (process.env.PATH || '') },
}), { label: 'ci-status 脱敏回归' })

describe('ci-status：凭据既不进 argv，也不进错误输出', () => {
  it('腿⓪ 机制对照：老办法（token 进 argv）失败时，假 token 确实会出现在 error.message 里', () => {
    let msg = ''
    try {
      execFileSync('curl', ['-s', '--max-time', '5', '--proxy', DEAD, '-H', `Authorization: Bearer ${FAKE}`,
        'https://api.github.com/repos/x/y'], { encoding: 'utf8' })
    } catch (e) { msg = String((e && e.message) || e) }
    expect(msg.length, 'curl 没失败 ⇒ 这条对照没有对象（换必死端口）').toBeGreaterThan(0)
    expect(msg.includes(FAKE),
      '对照失效：本机/本 CI 上 argv 不随 error.message 打印 ⇒ 下面那条"没泄漏"就成了空跑，必须换机器复跑')
      .toBe(true)
  })

  it('腿① 被测件：同一条必死代理下跑 ci-status ⇒ 它的两段输出里都搜不到那枚 token', () => {
    const r = runScript(shimDir())
    const all = `${r.stdout || ''}${r.stderr || ''}`
    expect(all.includes(FAKE), 'token 出现在输出里 ⇒ 又回到 argv 泄漏那条路了').toBe(false)
    expect(/(ghp|github_pat)_[A-Za-z0-9]{16,}/.test(all),
      '输出里有 PAT 形状的串（可能是真凭据被打印）').toBe(false)
  })

  it('腿② 失败语义：取不到数据走 rc=4 且说人话（不得静默 rc=0，也不得以崩栈代替诊断）', () => {
    const r = runScript(shimDir())
    expect(r.status, `应 rc=4，实得 ${r.status}｜${(r.stderr || '').slice(0, 200)}`).toBe(4)
    expect(r.stderr).toContain('[ci-status] FAIL')
    expect(r.stderr.split('\n')[0], '首行必须是自家诊断而不是栈').toMatch(/^\[ci-status\]/)
  })

  it('腿③ 垫片自证：假 token 真的进了脚本流程（否则①是弱断言）——用"能走到 curl 失败面"证', () => {
    const r = runScript(shimDir())
    // rc=4 只能由"取到 token 之后 curl 失败"产生（取不到 token 是另一条消息，不含 curl 字样）
    expect(r.stderr.toLowerCase().includes('curl'),
      '没走到 curl 失败面 ⇒ 本件在本机是弱断言，需在能走到的环境复跑：' + r.stderr.slice(0, 200)).toBe(true)
  })
})
