// 第三十七轮夹具：备份"先加密再上传"通道的密码学与 CLI 入口。
// 立它的实测：R36 一手事实 —— 本仓 2026-09-25 起 public，守卫拒绝把全库明文导出物放 artifact，
// 于是备份链 4/4 次零产物（生产库从未被备份）。第三条出路必须**可演习**，否则只是另一句措辞。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  encryptBuffer, decryptBuffer, inspect, parseContainer, deriveKey,
  MAGIC, VERSION, HEADER_LEN, SCRYPT_PARAMS, PASSPHRASE_ENV,
} from '../scripts/backup-crypto.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'backup-crypto.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'smbk-')); tmpDirs.push(d); return d }
const cli = (args, env = {}) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000,
}), { label: `backupCrypto cli ${args.join(' ')}` })
const PLAIN = Buffer.from('INSERT INTO products VALUES(1);\n-- 超市全库导出\n'.repeat(40))

describe('容器格式与密码学口径', () => {
  it('头是定长的：magic + version + salt + iv + tag（解析不靠分隔符，截断一定被发现）', () => {
    const c = encryptBuffer(PLAIN, 'release-response-step-brand-wrap')
    expect(c.subarray(0, MAGIC.length).toString('ascii')).toBe(MAGIC)
    expect(c[MAGIC.length]).toBe(VERSION)
    expect(HEADER_LEN).toBe(4 + 1 + 16 + 12 + 16)
    expect(c.length).toBe(HEADER_LEN + PLAIN.length)
    const p = parseContainer(c)
    expect([p.salt.length, p.iv.length, p.tag.length]).toEqual([16, 12, 16])
  })
  it('往返：同一口令解回逐字节相等；两次加密的密文不同（salt 随机 ⇒ 不做成确定性加密）', () => {
    const a = encryptBuffer(PLAIN, 'pw')
    const b = encryptBuffer(PLAIN, 'pw')
    expect(decryptBuffer(a, 'pw').equals(PLAIN)).toBe(true)
    expect(a.equals(b)).toBe(false)
    expect(deriveKey('pw', a.subarray(5, 21)).equals(deriveKey('pw', a.subarray(5, 21)))).toBe(true)
  })
  it('口令错 / 密文被翻一位 / 容器截断 —— 三种都必须抛（GCM tag 是判据，不吞）', () => {
    const c = encryptBuffer(PLAIN, 'right')
    expect(() => decryptBuffer(c, 'wrong')).toThrow(/GCM 校验失败/)
    const flip = Buffer.from(c); flip[flip.length - 1] ^= 0x01
    expect(() => decryptBuffer(flip, 'right')).toThrow(/GCM 校验失败/)
    expect(() => decryptBuffer(c.subarray(0, HEADER_LEN - 1), 'right')).toThrow(/短于定长头/)
    expect(() => decryptBuffer(Buffer.from(' plainly not a container at all!!!'.repeat(3)), 'right')).toThrow(/magic 不符/)
    const badVer = Buffer.from(c); badVer[MAGIC.length] = 9
    expect(() => decryptBuffer(badVer, 'right')).toThrow(/版本 9 未支持/)
  })
  it('空口令 / 空内容一律拒（"忘了配 secret"不能伪装成一份备份）', () => {
    expect(() => encryptBuffer(PLAIN, '')).toThrow(/口令为空/)
    expect(() => encryptBuffer(Buffer.alloc(0), 'pw')).toThrow(/内容为空/)
    expect(() => decryptBuffer(encryptBuffer(PLAIN, 'pw'), '')).toThrow(/口令为空/)
  })
  it('inspect 不需要口令就能区分密文与明文（判据要用它，不能让检查本身要求泄露口令）', () => {
    expect(inspect(encryptBuffer(PLAIN, 'pw')).encrypted).toBe(true)
    const not = inspect(PLAIN)
    expect(not.encrypted).toBe(false)
    expect(not.why).toContain('magic 不符')
  })
  it('scrypt 参数在册（N=2^15/r=8/p=1）：取舍要能被回读，不留"为什么这么小"的悬案', () => {
    expect(SCRYPT_PARAMS).toMatchObject({ N: 1 << 15, r: 8, p: 1 })
    expect(SCRYPT_PARAMS.maxmem).toBeGreaterThan(SCRYPT_PARAMS.N * 256)
  })
})

describe('CLI 入口（子进程真跑：断言退出码与产物，不看 stdout 好看）', () => {
  it('--encrypt 有口令 ⇒ rc=0 且落盘是密文容器', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk')
    writeFileSync(src, PLAIN)
    const r = cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
    expect(existsSync(out)).toBe(true)
    expect(inspect(readFileSync(out)).encrypted).toBe(true)
  })
  it('--encrypt 缺口令 ⇒ rc=2（响亮拒，绝不"那就写明文吧"）', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk')
    writeFileSync(src, PLAIN)
    const r = cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: '' })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2)
    expect(`${r.stdout}${r.stderr}`).toContain('未配')
    expect(existsSync(out), '拒加密时不许留下半个产物').toBe(false)
  })
  it('--verify 两向：同口令 rc=0；错口令 rc=1（这条是"备份可用性"的唯一证据）', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk')
    writeFileSync(src, PLAIN)
    cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    const ok = cli(['--verify', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(ok.status, `${ok.stdout}${ok.stderr}`).toBe(0)
    expect(ok.stdout).toContain('逐字节相等')
    const bad = cli(['--verify', src, out], { [PASSPHRASE_ENV]: 'typo' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('GCM 校验失败')
    // 原文被改过（备份链外的损坏）也必须红
    writeFileSync(src, PLAIN.toString('utf8') + 'DROP TABLE products;\n')
    const drift = cli(['--verify', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(drift.status, '原文与容器不等还放绿 ⇒ 判据没用').toBe(1)
  })
  it('--decrypt 到文件与到 stdout 两种出口；缺口令 rc=2；口令绝不从 argv 接受', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk'); const back = join(d, 'restored.sql')
    writeFileSync(src, PLAIN)
    cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(cli(['--decrypt', out, back], { [PASSPHRASE_ENV]: 'hunter2' }).status).toBe(0)
    expect(readFileSync(back).equals(PLAIN)).toBe(true)
    const toStdout = cli(['--decrypt', out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(toStdout.status).toBe(0)
    expect(Buffer.byteLength(toStdout.stdout, 'utf8')).toBe(PLAIN.length)
    const noPw = cli(['--decrypt', out], { [PASSPHRASE_ENV]: '' })
    expect(noPw.status).toBe(2)
    // 未知 flag（如 --passphrase）必须被**拒**而不是当位置参数吞掉 —— 否则 env 没配时会拿 argv 的口令解，
    // 口令就进了 ps/日志。判据方向相反：带未知 flag ⇒ rc=2。
    const argvPw = cli(['--decrypt', out, '--passphrase', 'hunter2'], { [PASSPHRASE_ENV]: '' })
    expect(argvPw.status, 'CLI 接受了未知 flag（口令可经 argv 传入 = 泄露面）').toBe(2)
  })
  it('--inspect：密文 rc=0 / 明文 rc=1（备份产物"是不是密文"是可机器判定的）', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk')
    writeFileSync(src, PLAIN)
    cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: 'hunter2' })
    expect(cli(['--inspect', out]).status).toBe(0)
    expect(cli(['--inspect', src]).status).toBe(1)
  })
  it('输入面不满足：缺模式/缺参数/文件不存在 ⇒ 分别 rc=2 且不崩栈', () => {
    expect(cli([]).status).toBe(2)
    expect(cli(['--encrypt', 'only-one']).status).toBe(2)
    const missing = cli(['--inspect', join(tmp(), 'nope.bin')])
    expect(missing.status).toBe(2)
    expect(`${missing.stdout}${missing.stderr}`).not.toMatch(/Traceback|TypeError: Cannot read/)
  })
  it('真仓跑假数据全链：encrypt → 删明文 → decrypt → 逐字节相等（恢复路径真的走得通）', () => {
    const d = tmp(); const src = join(d, 'dump.sql'); const out = join(d, 'dump.smbk'); const back = join(d, 'restored.sql')
    writeFileSync(src, PLAIN)
    expect(cli(['--encrypt', src, out], { [PASSPHRASE_ENV]: 'pw-a' }).status).toBe(0)
    rmSync(src)
    expect(cli(['--decrypt', out, back], { [PASSPHRASE_ENV]: 'pw-a' }).status).toBe(0)
    expect(readFileSync(back).equals(PLAIN)).toBe(true)
  })
})
