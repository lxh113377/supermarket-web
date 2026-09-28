// 第四十八轮 R48-H1：`verify:images` 的判据**自己**必须会被跑挂。
//
// 一手证据（本机 @2026-09-28 15:3x，修复前）：合成面里 seed 有 3 个 order、images 只有 2 张合法 WebP，
// 脚本如实印出「缺失图片 (1/3)｜覆盖率 66%」，**退出码仍是 0** —— `main()` 从不返回、`__main__` 也不 `sys.exit`。
// 更难看的是 `scripts/verify_images.py` 自己 2026-09-23 那段注释就点名了"每次都报缺失却仍 exit 0
// （静默的全面假失败）"，当时只修了路径漂移，**沉默本身留了五天**，而它至今不在任何阻断链上。
// 本文件把四档退出码钉成常驻夹具，并含一条**变异体**（把 rc=1 改成 rc=0，同一缺图面必须读成"通过"）
// —— 证明退出码真由那段代码产生，不是环境巧合。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'verify_images.py')
const dirs = []

const pythonBin = ['python', 'python3'].find((b) => {
  const r = spawnSync(b, ['--version'], { encoding: 'utf8', timeout: 20_000 })
  return r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)
})

/** 一张"合法"的 WebP 桩：RIFF....WEBP 魔数 + 超过 10KB 门槛。 */
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(12 * 1024)])

/**
 * 造一个最小合成仓（脚本按自身位置推导根目录，所以必须把 .py 复制进 <dir>/scripts/）。
 * `images` 的值是字节：Buffer 写盘、`null` 表示"这张图不存在"、`'nodir'` 表示整个图片面失踪。
 * `catOrders` 用来放**分类**段里的 `order:` —— 那个键名在真文件里有两个语义（分类排序 vs 图片文件名），
 * 分面必须按数据流划，所以这些号**不许**进应有集（第四十九轮的修法）。
 */
function face({ orders = [1, 2, 3], images = { 1: webp(), 2: webp(), 3: webp() }, catOrders = [], anchorless = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vi48-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src', 'data'), { recursive: true })
  cpSync(SCRIPT, join(dir, 'scripts', 'verify_images.py'))
  const cats = catOrders.length ? `export const categories = [${catOrders.map((o) => `{ order: ${o} }`).join(', ')}]\n` : ''
  const prods = anchorless ? `export const seed = [${orders.map((o) => `{ order: ${o} }`).join(', ')}]\n`
    : `export const products = [${orders.map((o) => `{ order: ${o} }`).join(', ')}]\n`
  writeFileSync(join(dir, 'src', 'data', 'products-seed.ts'), cats + prods, 'utf8')
  if (images !== 'nodir') {
    mkdirSync(join(dir, 'public', 'images'), { recursive: true })
    for (const [order, bytes] of Object.entries(images)) {
      if (bytes) writeFileSync(join(dir, 'public', 'images', `${order}.webp`), bytes)
    }
  }
  return dir
}

const run = (dir, script = 'scripts/verify_images.py') =>
  spawnSync(pythonBin, [script], { cwd: dir, encoding: 'utf8', timeout: 60_000 })

describe('verify:images 的四档退出码（判据自己必须会红）', () => {
  it('前置自证：本机有可用的 python3 系解释器（这条门禁已接进 verify 链与 CI，缺解释器就是红，不许静默跳过）', () => {
    expect(pythonBin, '环境缺 python/python3（3.x）⇒ 本轮把 verify:images 接进了阻断链，'
      + '取不到解释器必须显式失败，不能读成"这条判据不需要跑"').toBeTruthy()
  })

  it('正向：图片齐全 ⇒ rc=0，且尾部结论行点名件数', () => {
    const r = run(face())
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/\[verify-images\] OK 3\/3/)
  })

  it('反例（一手修复前的形状）：缺一张图 ⇒ rc=1 且点名缺几件（旧版这里印"覆盖率 66%"却 return 0）', () => {
    const r = run(face({ images: { 1: webp(), 2: webp(), 3: null } }))
    expect(r.status, '缺图必须非 0：' + r.stdout.split('\n').slice(-2).join(' / ')).toBe(1)
    expect(r.stdout).toMatch(/\[verify-images\] FAIL 缺失 1 \/ 无效 0 \/ 应有 3/)
  })

  it('反例：够大但不是图片（魔数不认）⇒ 计入"无效"并 rc=1，不许当成有效件', () => {
    const junk = Buffer.concat([Buffer.from('NOTAFILE'), Buffer.alloc(12 * 1024)])
    const r = run(face({ images: { 1: webp(), 2: webp(), 3: junk } }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/\[verify-images\] FAIL 缺失 0 \/ 无效 1 \/ 应有 3/)
  })

  it('边界：图片面整个不存在 ⇒ rc=2 UNVERIFIED，且**不得**把它算成"3 件全缺"（空集 ≠ 零覆盖）', () => {
    const r = run(face({ images: 'nodir' }))
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('UNVERIFIED 图片面不存在')
    expect(r.stdout).not.toContain('不可交付')
  })

  it('边界：数据源里 `order:` 零命中 ⇒ rc=2，**不得**退回旧的 1–49 兜底（兜底=把读不到伪装成"有 49 件且都合格"）', () => {
    const r = run(face({ orders: [], images: { 1: webp() } }))
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('应有图片集取不到')
    expect(r.stdout).toContain('零命中')
  })

  it('真入口回执：对真仓当场跑一次 ⇒ rc=0 且结论行的分母来自 seed 的 products 段（不是写死的 49）', () => {
    const r = run(REPO)
    expect(r.status, `真面应当全绿，实测 rc=${r.status}：${r.stdout.split('\n').slice(-1)}`).toBe(0)
    const m = /\[verify-images\] OK (\d+)\/(\d+)/.exec(r.stdout)
    expect(m, `结论行缺两个数：${r.stdout.split('\n').slice(-1)}`).toBeTruthy()
    const seed = readFileSync(join(REPO, 'src', 'data', 'products-seed.ts'), 'utf8')
    const at = seed.indexOf('export const products')
    expect(at, '真 seed 里没有 products 锚点 ⇒ 判据会记 UNVERIFIED，这条腿就成了空转').toBeGreaterThan(-1)
    const productsOnly = new Set([...seed.slice(at).matchAll(/\border:\s*(\d+)/g)].map((x) => Number(x[1])))
    const wholeFile = new Set([...seed.matchAll(/\border:\s*(\d+)/g)].map((x) => Number(x[1])))
    expect(Number(m[2]), '分母必须由 products 段现算').toBe(productsOnly.size)
    // 两把尺今天在真面上**恰好相等**（分类号段被商品号覆盖），所以这条不许当"面已分开"的证据；
    // 真正咬住分面的是下一条 categories 超号用例。
    expect(wholeFile.size).toBe(productsOnly.size)
  })

  it('R49 分面：categories 段的 order 超号**不得**进应有集（整文件扫描会凭空造出一条假"缺图"）', () => {
    const dir = face({ orders: [1, 2, 3], catOrders: [7777, 7778], images: { 1: webp(), 2: webp(), 3: webp() } })
    const r = run(dir)
    expect(r.status, `分类排序号被当成商品 ⇒ 假红：${r.stdout.split('\n').slice(-1)}`).toBe(0)
    expect(r.stdout).toMatch(/\[verify-images\] OK 3\/3/)
    // 反向半边：同一份 seed 换成"没有 products 锚点"的形态 ⇒ 必须 fail-closed 记 UNVERIFIED，
    // 而不是静默退回整文件扫描（那正是本轮要修的侥幸）。
    const back = run(face({ orders: [1, 2, 3], catOrders: [7777], anchorless: true }))
    expect(back.status, '锚点丢失必须 UNVERIFIED，不许退回整文件扫描').toBe(2)
    expect(back.stdout).toContain('分面锚点丢失')
    expect(back.stdout).not.toContain('应有 5')
  })

  it('R49 反向半边：有图无主 ⇒ 点名并计数，但**不判红**（seed 只是初始数据，删图是归属决定，不是判据处方）', () => {
    const r = run(face({ orders: [1, 2], images: { 1: webp(), 2: webp(), 3: webp() } }))
    expect(r.status, `孤儿图不该把门禁判红：${r.stdout.split('\n').slice(-1)}`).toBe(0)
    expect(r.stdout).toContain('无主图片 (1)')
    expect(r.stdout).toContain('order  3')
    expect(r.stdout).toContain('另有 1 张无主图')
    // 对照：真缺一张图时仍是 rc=1 ⇒ 证明上面那个 0 不是"什么都不判"
    expect(run(face({ orders: [1, 2, 3], images: { 1: webp(), 2: webp(), 3: null } })).status).toBe(1)
  })

  it('变异体：把临时副本里的 `return 1` 改成 `return 0` ⇒ 同一缺图面必须被读成"通过"（证明红因是那段代码）', () => {
    const dir = face({ images: { 1: webp(), 2: webp(), 3: null } })
    const target = join(dir, 'scripts', 'verify_images.py')
    const src = readFileSync(target, 'utf8')
    // 锚点写成行级正则而不是带 `\n` 的字面串：这台机器 `core.autocrlf=true`，盘上是 CRLF，
    // 用 `'        return 1\n'` 匹配不到 ⇒ 变异会"静默不发生"，然后 expect 反而拿不到红（第四十六轮同族）。
    const mutated = src.replace(/^ {8}return 1$/m, '        return 0')
    expect(mutated, '变异锚点已失效（脚本改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated, 'utf8')
    try {
      const r = run(dir)
      expect(r.status, '摘掉"缺陷 ⇒ rc=1"之后探针仍判红 ⇒ 这条腿没打在被告分支上').toBe(0)
      expect(r.stdout).toContain('FAIL 缺失 1')
    } finally {
      cpSync(SCRIPT, target)
      expect(run(dir).status, '还原后必须重新判红（证明那个 0 是变异造成的）').toBe(1)
    }
  })
})

// 合成面是临时件：必须挂在 afterAll 上（写成模块尾部的裸循环会在**测试跑之前**就把目录删光）。
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
