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
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs'
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

/**
 * 起子进程跑探针面。默认 `VERIFY_IMAGES_LIVE=off` —— 这些夹具判的是 **seed 面**，
 * 让它们去连生产 URL 会把"这一刻 pages.dev 通不通"混进结论（时序型时间炸弹，第四十九轮同族）。
 * 现网面由下面 `describe('R50-H1 现网面')` 用本地桩服务器单独驱动（env 传 `VERIFY_IMAGES_LIVE_URL`）。
 */
const run = (dir, env = {}) =>
  spawnSync(pythonBin, ['scripts/verify_images.py'], {
    cwd: dir, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, VERIFY_IMAGES_LIVE: 'off', ...env },
  })

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

  it('R50 真入口（默认开现网面）：无论通不通，结论行**必须声明现网面的状态**，不得沉默', () => {
    // 这条不要求网络可达 —— 它判的是"盲区有没有被说出来"：可达 ⇒ 印并集；不可达 ⇒ 印 UNVERIFIED。
    // 上一轮的真面输出两种情况长得一模一样（只有裸分母 54），这正是"没量到"被读成"量过了"。
    const r = run(REPO, { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_TIMEOUT: '20' })
    expect(r.status, `真面 rc=${r.status}：${r.stdout.split('\n').slice(-1)}`).toBe(0)
    const declared = /现网在售依赖本地件 (\d+ 号|UNVERIFIED)/.test(r.stdout)
    expect(declared, `覆盖面行没声明现网面状态：${r.stdout.split('\n').filter((l) => l.includes('覆盖面'))}`).toBe(true)
    expect(r.stdout, '现网面取不到时结论行必须说"只判了 seed"').toMatch(
      /(面=seed \d+ ∪ 现网在售 \d+|现网 UNVERIFIED ⇒ 本轮只判了 seed)/)
    // 真面上的实测口径（@2026-09-28）：现网在售 25 条的 image **全为空** ⇒ 并集应为 55（seed 54 + 55 号）
    if (/∪ 现网在售 (\d+)/.test(r.stdout)) {
      expect(Number(/∪ 现网在售 (\d+)/.exec(r.stdout)[1]), '现网在售数由 /pub 现读，写死的期望会自判红').toBeGreaterThan(0)
      expect(r.stdout).toContain('盲区（不得当成已判）')
    }
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

/**
 * R50-H1：现网面。夹具**必须**打在被告分支上（②-b）——所以这里起一个真的 HTTP 桩，
 * 让脚本走 `urllib` 那条真取数路径，而不是给它塞一个假读数。
 * 一手动因：真仓实测 seed=1..54、现网在售含 55、`public/images/55.webp` 存在 ⇒
 * 旧分母"seed 的 order"天生残缺，线上商品缺图这条门禁永远看不见，还把 55 号假归因成"无主图"。
 *
 * ⚠️ 桩**必须是独立进程**：本文件的 `run()` 用 `spawnSync`，它会把 node 事件循环整个阻塞住，
 * 于是同进程里的 `createServer` 根本来不及 accept —— 实测表现为每条腿恰好卡满 8s（默认超时）后
 * 走"现网不可达"出口，看着像代码坏了，其实是夹具与环境在互相饿死（第一轮就踩在这上面）。
 */
const stubs = []
const STUB_SRC = `
const { createServer } = require('node:http')
const fs = require('node:fs')
const payload = process.env.STUB_PAYLOAD || '{}'
const srv = createServer((req, res) => {
  let b = ''
  req.on('data', (c) => { b += c })
  req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(payload) })
})
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(process.env.STUB_PORT_FILE, String(srv.address().port)))
`
const stubLive = async (payload) => {
  const portFile = join(mkdtempSync(join(tmpdir(), 'vi50p-')), 'port')
  // 端口经**环境变量**回传：`node -e` 下 argv 语义与跑脚本不同（argv[1] 才是第一个用户参数），
  // 上一版按 argv[2] 取值 ⇒ 子进程写盘即抛、桩永远不起（那条腿当时正确报了"夹具坏了"而不是假绿）。
  const child = spawn('node', ['-e', STUB_SRC], {
    env: { ...process.env, STUB_PAYLOAD: JSON.stringify(payload), STUB_PORT_FILE: portFile },
    stdio: 'ignore',
  })
  stubs.push(child)
  child.on('error', (e) => { throw e })
  const deadline = Date.now() + 8000
  let port = 0
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const raw = readFileSync(portFile, 'utf8').trim()
      if (/^\d+$/.test(raw)) { port = Number(raw); break }
    }
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 40))
  }
  expect(port, '桩子进程没吐出端口 ⇒ 现网面的腿无法驱动（不是判据红，是夹具坏了）').toBeGreaterThan(0)
  return `http://127.0.0.1:${port}/pub`
}


describe('verify:images 的现网面（分母 = seed ∪ 现网在售，取不到只声明盲区）', () => {
  it('新牙齿：现网在售而 seed 没有的号**缺图** ⇒ rc=1（旧分母永远看不见这一面）', async () => {
    const url = await stubLive({ code: 0, data: [{ _id: 'p_x', order: 4, image: '' }] })
    const r = run(face({ orders: [1, 2, 3] }), { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
    expect(r.status, `线上在售的 4 号没图必须拦：${r.stdout.split('\n').slice(-2)}`).toBe(1)
    expect(r.stdout).toMatch(/\[verify-images\] FAIL 缺失 1 \/ 无效 0 \/ 应有 4/)
    expect(r.stdout).toContain('面=seed 3 ∪ 现网在售 1')
    expect(r.stdout).toContain('seed 落后于现网：[4]')
  })

  it('同一号图齐 ⇒ rc=0，且归因写"seed 落后于现网"而**不得**叫"无主图"（上一轮的假归因）', async () => {
    const url = await stubLive({ code: 0, data: [{ _id: 'p_x', order: 4, image: '' }] })
    const r = run(face({ orders: [1, 2, 3], images: { 1: webp(), 2: webp(), 3: webp(), 4: webp() } }),
      { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/\[verify-images\] OK 4\/4/)
    expect(r.stdout).toContain('无主图片 (0)')
    expect(r.stdout).not.toContain('另有 1 张无主图')
  })

  it('带自定义 image 字段的在售条目不入分母（前端 `product.image || productImageUrl(order)` 根本不碰本地件）', async () => {
    const url = await stubLive({ code: 0, data: [{ _id: 'p_a', order: 9, image: 'https://cdn.example/a.png' }] })
    const r = run(face({ orders: [1, 2, 3] }), { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/\[verify-images\] OK 3\/3/)
    expect(r.stdout).toContain('另 1 条带自定义 image 字段')
  })

  it('现网不可达 ⇒ seed 面照判（rc 不变），但必须印 UNVERIFIED 且**不得**断言孤儿图"无主"', () => {
    // 端口 1 是保留端口，连不上且立刻失败（不靠网络超时，避免 CI 慢腿）
    const r = run(face({ orders: [1, 2], images: { 1: webp(), 2: webp(), 3: webp() } }),
      { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: 'http://127.0.0.1:1/pub', VERIFY_IMAGES_LIVE_TIMEOUT: '3' })
    expect(r.status, `现网通不通不该改变 seed 面结论：${r.stdout.split('\n').slice(-1)}`).toBe(0)
    expect(r.stdout).toContain('UNVERIFIED')
    expect(r.stdout).toContain('现网 UNVERIFIED ⇒ 本轮只判了 seed')
    expect(r.stdout).toContain('不足证无主')
  })

  it('现网响应形状不对（code≠0）⇒ 同 UNVERIFIED，禁止读成"线上没货"（④-b 读不动≠结论为否）', async () => {
    const url = await stubLive({ code: -1, msg: 'boom' })
    const r = run(face({ orders: [1, 2, 3] }), { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('现网响应形状不对')
    expect(r.stdout).not.toContain('∪ 现网在售 0')
  })

  it('变异体：摘掉"并上现网面"那一行 ⇒ 自相矛盾守卫必须接管（rc=2 而不是继续判绿）', async () => {
    const url = await stubLive({ code: 0, data: [{ _id: 'p_x', order: 4, image: '' }] })
    const dir = face({ orders: [1, 2, 3] })
    const target = join(dir, 'scripts', 'verify_images.py')
    const src = readFileSync(target, 'utf8')
    const mutated = src.replace(/^    expected = seed_orders \| \(live_orders or set\(\)\)$/m, '    expected = set(seed_orders)')
    expect(mutated, '变异锚点已失效（脚本改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated, 'utf8')
    try {
      const r = run(dir, { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
      expect(r.status, '摘掉并集后仍判 0/1 ⇒ 守卫没接管，覆盖面那行是装饰').toBe(2)
      expect(r.stdout).toContain('覆盖面自相矛盾')
    } finally {
      cpSync(SCRIPT, target)
      const back = run(dir, { VERIFY_IMAGES_LIVE: 'on', VERIFY_IMAGES_LIVE_URL: url })
      expect(back.status, '还原后必须回到"判出缺图"的 1').toBe(1)
      expect(back.stdout).toContain('缺失图片 (1/4)')
    }
  })
})

// 合成面是临时件：必须挂在 afterAll 上（写成模块尾部的裸循环会在**测试跑之前**就把目录删光）。
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  for (const child of stubs) child.kill()
})
