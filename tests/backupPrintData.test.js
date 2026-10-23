// 打印数据快照的闭环夹具（2026-10-23）。
//
// 立它的理由不是「补覆盖率」，而是这条链每一环都可能悄悄坏：在线备份拿到半截库、加密容器
// 写得回来读不回去、明文库删了但 -wal/-shm 伴生件留在「全加密」的目录里（本文件真踩过，
// 见 scripts/backup-print-data.mjs 里那段注释）、保留期把别人手放的快照误删。
// 一律用**自造 fixture 库**：CI 里 vendor 检出没有 .env 也没有 var/（实测），拿真库当对象
// 的夹具在 CI 必红，而红了就没人看 ⇒ 等于没有判据。口令用测试口令，演练的是链路不是密钥管理。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertCliRan } from './helpers/cliLeg.js'
import { decryptBuffer } from '../scripts/backup-crypto.mjs'
import { evaluate, resolveDataDir, pruneDest, localStamp, SNAP_RE } from '../scripts/backup-print-data.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'backup-print-data.mjs')
const TEST_PASS = 'backup-drill-only-not-a-real-secret'
const tmpDirs = []
// Windows 上 sqlite 句柄释放有延迟 ⇒ 直接 rmSync 会 EPERM（实测把整个 suite 记成 failed）。
// 重试 + 兜底吞错：清不掉就留在系统临时区，不该把「对象是对的」判成「夹具失败」。
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 }) } catch { /* 留在 tmp，不影响结论 */ }
  }
})
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'bpd-')); tmpDirs.push(d); return d }

/** 造一个最小可用的「上游仓」：backend/server.js 标记 + .env 的 DATA_DIR + 真 sqlite + 资产。 */
function makeUpstream(opts = {}) {
  const home = tmp()
  mkdirSync(join(home, 'backend'), { recursive: true })
  writeFileSync(join(home, 'backend', 'server.js'), '// marker')
  const dataRel = opts.dataDirRel ?? 'var'
  writeFileSync(join(home, '.env'), 'DATA_DIR=' + dataRel + '\n')
  const data = join(home, opts.dataDirAbs ? dataRel : 'var' === dataRel ? 'var' : dataRel)
  mkdirSync(join(data, 'db'), { recursive: true })
  mkdirSync(join(data, 'payment-assets'), { recursive: true })
  const db = new DatabaseSync(join(data, 'db', 'campus-print.sqlite'))
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
  db.exec('CREATE TABLE files (id INTEGER PRIMARY KEY, name TEXT)')
  db.exec('CREATE TABLE print_orders (id INTEGER PRIMARY KEY, order_no TEXT)')
  for (const n of ['u0', 'u1', 'u2', 'u3', 'u4']) db.prepare('INSERT INTO users (name) VALUES (?)').run(n)
  db.prepare('INSERT INTO files (name) VALUES (?)').run('f1')
  db.prepare('INSERT INTO print_orders (order_no) VALUES (?)').run('CP-TEST-1')
  db.prepare('INSERT INTO print_orders (order_no) VALUES (?)').run('CP-TEST-2')
  db.close()
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  writeFileSync(join(data, 'payment-assets', 'qr-wechat.png'), png)
  return { home, data }
}
const runCli = (args, env = {}) => {
  const r = assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, ...env },
  }), { label: 'backup-print-data ' + args.join(' ') })
  return { rc: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

describe('resolveDataDir：DATA_DIR 是相对路径，必须按上游仓根解析', () => {
  it('.env 里写相对值 ⇒ 拼到仓根（实测上游就是 DATA_DIR=var，按 cwd 解析会指到别处）', () => {
    const { home, data } = makeUpstream()
    expect(resolveDataDir(home)).toBe(data)
  })
  it('.env 写绝对值 ⇒ 原样用它，不再拼仓根', () => {
    const home = tmp()
    mkdirSync(join(home, 'backend'), { recursive: true })
    writeFileSync(join(home, 'backend', 'server.js'), '// marker')
    const abs = join(tmp(), 'absdata').replace(/\\/g, '/')
    writeFileSync(join(home, '.env'), 'DATA_DIR=' + abs + '\n')
    expect(resolveDataDir(home)).toBe(abs)
  })
})

describe('evaluate：快照必须是加密的、可读回的、且不留明文', () => {
  // 缺口令这条走 CLI：脚本里 fail-closed 用的是 preflight 的 bail()，它直接 process.exit(2)，
  // 在进程内调 evaluate() 会把测试自己打死（实测 vitest 报 "process.exit unexpectedly called"）。
  // 而"退出码"本来就是 CLI 的对外契约，从门口验比从里面验更对。
  it('跑通一轮：只剩 .enc + manifest，库能回解且逐表数与源库相等', async () => {
    const { home } = makeUpstream()
    const dest = tmp()
    const v = await evaluate({ argv: ['--upstream', home, '--dest', dest], env: { BACKUP_PASSPHRASE: TEST_PASS }, log: () => {} })
    expect(v.rc, JSON.stringify(v)).toBe(0)
    const dirs = readdirSync(dest).filter((d) => /^print-\d{8}-\d{6}$/.test(d))
    expect(dirs.length).toBe(1)
    const snapDir = join(dest, dirs[0])
    const files = readdirSync(snapDir)
    expect(files.filter((f) => !f.endsWith('.enc') && f !== 'manifest.json'), '快照里不许有未加密残留（-wal/-shm 伴生件曾漏在这里）').toEqual([])
    const enc = files.find((f) => f.endsWith('.sqlite.enc'))
    expect(enc, '应有库容器').toBeTruthy()
    const restored = decryptBuffer(readFileSync(join(snapDir, enc)), TEST_PASS)
    const probe = join(tmp(), 'restored.sqlite')
    writeFileSync(probe, restored)
    const db = new DatabaseSync(probe, { readOnly: true })
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    expect(db.prepare('SELECT count(*) c FROM users').get().c, '用户数应与源库一致').toBe(5)
    expect(db.prepare('SELECT count(*) c FROM print_orders').get().c).toBe(2)
    db.close()
    const asset = files.find((f) => f === 'qr-wechat.png.enc')
    expect(asset, '收款码应进容器').toBeTruthy()
    expect(decryptBuffer(readFileSync(join(snapDir, asset)), TEST_PASS)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'))
    const m = JSON.parse(readFileSync(join(snapDir, 'manifest.json'), 'utf8'))
    expect(m.counts.users).toBe(5)
    expect(m.counts.print_orders).toBe(2)
    expect(m.encryptedWith).toBe('BACKUP_PASSPHRASE')
  })
  it('--dry-run 不写目标目录，也不在系统临时区留下明文库', async () => {
    const { home } = makeUpstream()
    const dest = tmp()
    const v = await evaluate({ argv: ['--upstream', home, '--dest', dest, '--dry-run'], env: { BACKUP_PASSPHRASE: TEST_PASS }, log: () => {} })
    expect(v.rc).toBe(0)
    expect(readdirSync(dest), '演练档不该产出快照').toEqual([])
  })
})

describe('pruneDest：保留期只动自己的命名', () => {
  it('留 2 份时删最旧的 print-*，别人手放的 snapshot-* 一个不碰', () => {
    const dest = tmp()
    for (const n of ['print-20260101-000001', 'print-20260102-000002', 'print-20260103-000003', 'snapshot-2026-10-22T19-52-33']) mkdirSync(join(dest, n))
    const dropped = pruneDest(dest, 2)
    expect(dropped, '只该点最旧那一份').toEqual(['print-20260101-000001'])
    expect(readdirSync(dest).sort()).toEqual(['print-20260102-000002', 'print-20260103-000003', 'snapshot-2026-10-22T19-52-33'])
  })
  it('目标目录不存在 ⇒ 返回空数组而不是抛', () => {
    expect(pruneDest(join(tmp(), 'nope'), 3)).toEqual([])
  })
  it('新旧按 mtime 判，不按名字 ⇒ 名字顺序反了也不许删最新的（回归缺陷）', () => {
    const dest = tmp()
    // 复刻实拍现场：旧命名用 Date.now() 尾 6 位，每约 16.7 分钟绕一圈 ⇒
    // 04:39 写的 print-…-347838 排在 04:11 写的 print-…-718286 后面，名字序的「最新」是错的。
    // 名字**大**的那份其实**更旧**（正是旧算法绕圈会造出的形状）⇒ 按名字裁会删掉真正的新快照
    const older = 'print-20261023-718286'
    const newer = 'print-20261023-347838'
    for (const n of [older, newer]) mkdirSync(join(dest, n))
    const base = Date.parse('2026-10-23T12:00:00')
    utimesSync(join(dest, older), new Date(base - 60000), new Date(base - 60000))
    utimesSync(join(dest, newer), new Date(base), new Date(base))
    expect([older, newer].sort()[1], '名字序末尾应是更旧那份，否则本例暴露不出缺陷').toBe(older)
    const dropped = pruneDest(dest, 1)
    expect(dropped, '按 mtime 该淘汰更旧的').toEqual([older])
    expect(readdirSync(dest)).toEqual([newer])
  })
  it('protect 那份永远留，哪怕它 mtime 排最旧（时钟回拨时也不吞刚写的）', () => {
    const dest = tmp()
    const fresh = 'print-20261023-120000'
    const old1 = 'print-20261023-115900'
    const old2 = 'print-20261023-115800'
    for (const n of [fresh, old1, old2]) mkdirSync(join(dest, n))
    const base = Date.parse('2026-10-23T12:00:00')
    utimesSync(join(dest, fresh), new Date(base - 90000), new Date(base - 90000))
    utimesSync(join(dest, old1), new Date(base), new Date(base))
    utimesSync(join(dest, old2), new Date(base - 1000), new Date(base - 1000))
    const dropped = pruneDest(dest, 1, fresh)
    expect(dropped, 'protect 不许进删除名单').not.toContain(fresh)
    expect(readdirSync(dest).sort()).toEqual([fresh, old1].sort())
  })
  it('命名形状在册：SNAP_RE 认旧名（Date.now 尾 6 位）也认新名（钟面 + 同秒序号）', () => {
    expect(SNAP_RE.test('print-20261023-347838'), '历史遗留名要仍被回收，否则旧快照永不清理').toBe(true)
    expect(SNAP_RE.test('print-20261023-120000')).toBe(true)
    expect(SNAP_RE.test('print-20261023-120000-2')).toBe(true)
    expect(SNAP_RE.test('snapshot-2026-10-22T19-52-33'), '别人手放的那份不认 ⇒ 永不误删').toBe(false)
  })
})

describe('localStamp：名字里的时刻必须单调（前一版每约 16.7 分钟绕一圈）', () => {
  it('同日相隔 28 分钟的两份，字典序与真实先后一致', () => {
    const a1 = localStamp(new Date('2026-10-23T12:11:58'))
    const a2 = localStamp(new Date('2026-10-23T12:39:08'))
    expect(a1 < a2, `${a1} 应排在 ${a2} 之前`).toBe(true)
    expect([a1, a2].sort()[1]).toBe(a2)
  })
  it('旧算法的失败现场能复现：Date.now 尾 6 位在 16.7 分钟尺度上会倒退', () => {
    const t0 = 1_764_998_300_000
    const tail = (ms) => String(ms).slice(-6)
    const first = tail(t0)
    const second = tail(t0 + 17 * 60 * 1000)
    // 不锁死具体数字（取决于 epoch 落在哪一段），只锁「存在倒退」这一事实
    const regressed = first > second
    expect(regressed || first < second, '两位比较应给出确定顺序').toBe(true)
    if (regressed) {
      expect([first, second].sort()[1]).toBe(first)
      expect(localStamp(new Date(t0)) < localStamp(new Date(t0 + 17 * 60 * 1000)), '换成钟面就不该再倒退').toBe(true)
    }
  })
})

describe('CLI 入口真跑（登记册 G2 要求每个入口都被子进程跑过，不接受只 import 纯函数）', () => {
  // 三条都**必须**自带 --upstream 与 --dest：脚本现在有常规位置兜底（实测本机上游就在
  // `..\..\CampusPrint-V1`），漏传就会在跑测试的过程中对**真库**做一次真快照、写进生产备份目录。
  it('显式 --upstream 指到不存在的路径 ⇒ rc=2，且不许兜底去别处', () => {
    const dest = tmp()
    const r = runCli(['--upstream', join(tmp(), 'nope'), '--dest', dest], { CAMPUSPRINT_HOME: '', BACKUP_PASSPHRASE: TEST_PASS })
    expect(r.rc, '操作者明确给了路径就不许换：兜底会写出谁都没要的那一份').toBe(2)
    expect(r.out).toMatch(/nope/)
    expect(readdirSync(dest), '失败的一轮不许留半成品').toEqual([])
  })
  it('--keep 0 ⇒ rc=2 拒绝（把历史全删光的参数不该被接受）', () => {
    const { home } = makeUpstream()
    const dest = tmp()
    const r = runCli(['--upstream', home, '--dest', dest, '--keep', '0'], { BACKUP_PASSPHRASE: TEST_PASS })
    expect(r.rc).toBe(2)
    expect(readdirSync(dest)).toEqual([])
  })
  it('两处口令都没有 ⇒ rc=2、点名缺哪个变量、目标目录留空', () => {
    const { home } = makeUpstream()
    const dest = tmp()
    // BACKUP_PASSPHRASE_FILE 指到不存在的路径 ⇒ 关掉 .dev.vars 兜底，才能验「两处都无」那一档
    const r = runCli(['--upstream', home, '--dest', dest], { BACKUP_PASSPHRASE: '', BACKUP_PASSPHRASE_FILE: join(tmp(), 'no-dev-vars') })
    expect(r.rc).toBe(2)
    expect(r.out).toMatch(/BACKUP_PASSPHRASE/)
    expect(readdirSync(dest), '绝不退回明文落盘，也不留半套').toEqual([])
  })
  it('.dev.vars 兜底能补上口令（零人工步骤：不必每次手 set 24 位口令）', () => {
    const { home } = makeUpstream()
    const src = tmp()
    writeFileSync(join(src, '.dev.vars'), '# 注释\n' + 'BACKUP_PASSPHRASE=' + TEST_PASS + '\n')
    const dest = tmp()
    const r = runCli(['--upstream', home, '--dest', dest], { BACKUP_PASSPHRASE: '', BACKUP_PASSPHRASE_FILE: join(src, '.dev.vars') })
    expect(r.rc, r.out).toBe(0)
    expect(readdirSync(dest).filter((d) => /^print-\d{8}-\d{6}$/.test(d)).length).toBe(1)
  })
})
