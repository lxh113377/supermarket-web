/* oxlint-disable no-console -- 浏览器错误需要打印到 stdout 才能进 CI 日志 */
import { test, expect } from '@playwright/test'

/**
 * 商品详情页「真实布局」e2e —— 必须跑在**生产构建**上，不能跑 dev。
 *
 * 为什么单开一套：index.html 的 CSP 是 `style-src 'self'`（无 unsafe-inline）。
 * dev 模式下 Vite 用 <style> 元素注入 CSS ⇒ 被 CSP 整块拦掉 ⇒ 页面**完全没有样式**，
 * 于是"双栏并排 / 焦点环 / 响应式重排 / 是否横向溢出"这类几何断言在 dev 里结构上不可能通过
 * （实测：1440 视口下信息栏 x=8，两栏退化成堆叠）。
 * 生产构建把 CSS 输出成独立文件（/assets/index-*.css），style-src 'self' 放行，
 * 这些判据才有意义。React 用 CSSOM 写的内联样式不受该 CSP 影响，
 * 所以变体色块的上色在 dev 与 prod 都真（已各自实测）。
 */

const DESKTOP = { width: 1440, height: 900 }
const TABLET = { width: 768, height: 1024 }
const MOBILE = { width: 390, height: 844 }

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('BROWSER-ERR:', m.text().slice(0, 200))
  })
})

/** 先证明样式真的生效了，否则后面所有几何断言都是假的 */
async function assertCssLive(page: import('@playwright/test').Page) {
  // bg-surface 挂在页面根 div 上（body 本身无背景），探这个类才代表 Tailwind 令牌生效
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.bg-surface')
    return el ? getComputedStyle(el).backgroundColor : 'NO-EL'
  })
  expect(bg, 'Tailwind 未生效（很可能跑在 dev 上被 CSP 拦了 CSS）').toBe('rgb(250, 250, 249)')
}

async function open(page: import('@playwright/test').Page, order: number, vp = DESKTOP) {
  await page.setViewportSize(vp)
  await page.goto(`/#/product/p_${order}`)
  await expect(page.getByLabel('购买数量', { exact: true })).toBeVisible({ timeout: 20_000 })
  await assertCssLive(page)
}

test('桌面 1440：主图 + 缩略图列在左，购买信息在右，两栏真正并排', async ({ page }) => {
  await open(page, 16)
  const g = await page.locator('[data-main-image]').boundingBox()
  const i = await page.getByRole('heading', { level: 2, name: '盒装东鹏特饮' }).boundingBox()
  expect(g && i).toBeTruthy()
  // 信息栏起点在主图右半之外 ⇒ 确实并排而非堆叠
  expect(i!.x).toBeGreaterThan(g!.x + g!.width * 0.6)
  expect(Math.abs(i!.y - g!.y)).toBeLessThan(300)
  // 「大幅」主图：明显宽于缩略图列（5 倍以上），且在宽屏下达到可读尺寸
  expect(g!.width).toBeGreaterThan(450)
  const thumbs = await page.getByRole('navigation', { name: /图片缩略图/ }).boundingBox()
  expect(g!.width).toBeGreaterThan(thumbs!.width * 5)
  // 缩略图列竖排在主图左侧（桌面端 lg:order-first）
  expect(thumbs!.x + thumbs!.width).toBeLessThanOrEqual(g!.x + 8)
})

/**
 * 回归锁：网格默认 align-items:stretch 会把左栏卡片拉到与右栏（内容长得多）等高，
 * 实测截图上表现为图片下方一大块空白。lg:items-start 修掉，这里钉住。
 */
test('左栏卡片不被网格拉伸，主图下方不留大片空白', async ({ page }) => {
  await open(page, 16)
  const m = await page.evaluate(() => {
    const gal = document.querySelector('[data-main-image]')!
    const card = gal.parentElement!.parentElement!      // ProductGallery 根（网格项）
    const img = document.querySelector('[data-main-image] img')!
    return { card: card.getBoundingClientRect().height, img: img.getBoundingClientRect().height }
  })
  // 卡片高度应约等于图片区高度（留 p-4 内边距的余量），而不是被拉到右栏那么高
  expect(m.card).toBeLessThan(m.img + 80)
})

test('暖白底 + 近黑字，正文对比度过 AA', async ({ page }) => {
  await open(page, 16)
  const c = await page.evaluate(() => {
    const h2 = document.querySelector('h2')!
    const card = h2.closest('div')!
    return {
      fg: getComputedStyle(h2).color,
      cardBg: getComputedStyle(card).backgroundColor,
      pageBg: getComputedStyle(document.querySelector('.bg-surface')!).backgroundColor,
    }
  })
  expect(c.fg).toBe('rgb(17, 24, 39)') // gray-900 近黑
  expect(c.pageBg).toBe('rgb(250, 250, 249)') // 暖白页底
  expect(c.cardBg).toBe('rgba(0, 0, 0, 0)') // 桌面右栏透出暖白底
  // 相对亮度法算 #111827 on #fafaf9 的对比度（AA 正文要求 >= 4.5）
  const ratio = (hex: string) => {
    const [r, gg, b] = hex.match(/\w\w/g)!.map((x) => parseInt(x, 16) / 255)
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b)
  }
  const l1 = ratio('111827')
  const l2 = ratio('fafaf9')
  expect((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toBeGreaterThan(4.5)
})

test('内容可纵向滚到到底，不靠固定画布或隐藏溢出裁切', async ({ page }) => {
  await open(page, 6)
  // 本应用是 100dvh + 内层 overflow-y-auto 的壳（document 本身不滚），
  // 所以判据必须落在真正的滚动容器上，量 documentElement 会恒为 false
  const s = await page.evaluate(() => {
    const el = document.querySelector('#root .overflow-y-auto') as HTMLElement | null
    if (!el) return null
    return {
      scrollable: el.scrollHeight > el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      hidden: getComputedStyle(el).visibility,
      clipped: getComputedStyle(el).overflowY === 'hidden' || getComputedStyle(el).clipPath !== 'none',
    }
  })
  expect(s, '找不到内层滚动容器').not.toBeNull()
  expect(s!.scrollable).toBe(true)
  expect(s!.overflowY).toBe('auto')
  expect(s!.clipped).toBe(false)
  // 逐块滚进视口：证明每段内容都真的可达，而不是被裁在容器外
  for (const name of ['商品参数', '配送说明', '售后说明', '同类商品']) {
    const loc = page.getByRole('heading', { name }).first()
    await loc.scrollIntoViewIfNeeded()
    await expect(loc).toBeInViewport()
  }
  // 滚到底后仍能看见页尾
  await page.evaluate(() => {
    const el = document.querySelector('#root .overflow-y-auto') as HTMLElement
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByRole('heading', { name: '写评价' })).toBeInViewport()
})

test('平板 768 与手机 390：重排为单列（主图在上、信息在下），且无横向溢出', async ({ page }) => {
  for (const vp of [TABLET, MOBILE]) {
    await open(page, 16, vp)
    const g = await page.locator('[data-main-image]').boundingBox()
    const i = await page.getByRole('heading', { level: 2, name: '盒装东鹏特饮' }).boundingBox()
    expect(i!.y).toBeGreaterThan(g!.y + g!.height - 60)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${vp.width}px 视口出现横向溢出`).toBeLessThanOrEqual(1)
  }
})

test('手机 390：吸底栏吸附在视口内，没被安全区顶出屏幕', async ({ page }) => {
  await open(page, 16, MOBILE)
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(1)
  const box = await page.getByRole('button', { name: '加入购物车' }).boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(MOBILE.height)
})

test('键盘焦点环真实可见（不是 outline:none）', async ({ page }) => {
  await open(page, 16)
  const add = page.getByRole('button', { name: '加入购物车' })
  await add.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }
  })
  expect(ring.style).toBe('solid')
  expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2)
})

test('口味色块在生产构建里仍带上色（CSP 未拦内联上色）', async ({ page }) => {
  await open(page, 6)
  const bg = await page.getByRole('button', { name: '绿茶', exact: true }).locator('span[aria-hidden="true"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(76, 122, 52)')
})

test('推荐卡与主图不产生布局位移（CLS 友好：图片有固有尺寸）', async ({ page }) => {
  await open(page, 16)
  const dims = await page.locator('[data-main-image] img').evaluate((el) => ({
    w: el.getAttribute('width'), h: el.getAttribute('height'), loading: el.getAttribute('loading'),
  }))
  expect(dims.w).toBe('600')
  expect(dims.h).toBe('288')
  expect(dims.loading).toBe('lazy')
})

/**
 * 上架素材底色不一（白底抠图 vs 深色/场景底实拍），四列并排时深色图会形成硬边黑方块。
 * 缓解方案是纯 CSS 的统一图区底板 + `mix-blend-mode: multiply`（白底素材的白边与底板
 * 相乘后消失）。这里钉住"所有卡片共用同一块底板、且图片确实参与混合"，
 * 防止以后有人把 .gallery-figure 改回逐卡 bg-white。
 */
test('图区底板全站统一且图片参与 multiply 混合（素材底色不一致的缓解判据）', async ({ page }) => {
  await openShop(page, '/shop/drinks')
  const m = await page.evaluate(() => {
    const figs = [...document.querySelectorAll('.gallery-figure')]
    const bgs = new Set(figs.map((el) => getComputedStyle(el).backgroundColor))
    const blends = new Set([...figs]
      .map((el) => {
        const img = el.querySelector('img')
        return img ? getComputedStyle(img).mixBlendMode : null
      })
      .filter((v): v is string => v !== null))
    return { figures: figs.length, distinctBg: bgs.size, bg: [...bgs][0], distinctBlend: blends.size, blend: [...blends][0] }
  })
  expect(m.figures).toBeGreaterThan(4)
  expect(m.distinctBg, '所有卡片必须共用同一块图区底板').toBe(1)
  expect(m.bg).toBe('rgb(246, 245, 242)')
  expect(m.blend).toBe('multiply')
  expect(m.distinctBlend).toBe(1)
})

/**
 * 回归锁：.tap-44 曾写在裸 CSS 区（优先级高于所有 @layer），它的 position:relative
 * 会盖掉 Tailwind utilities 层的 absolute ⇒ 所有 `tap-44 absolute` 角标按钮退化成流式排布。
 * 实测表现：轮播箭头被挤到图片下方，且把 group 高度从 420 撑到 484。
 * 修法：.tap-44 收进 @layer components。这里同时验「箭头是 absolute」和「group 高 == 图高」。
 */
test('tap-44 不得压过 Tailwind 的 absolute（角标按钮定位回归锁）', async ({ page }) => {
  await open(page, 16)
  const m = await page.evaluate(() => {
    const r = (el: Element | null) => el ? el.getBoundingClientRect() : null
    const group = document.querySelector('[role="group"]')
    const img = document.querySelector('[data-main-image] img')
    const prev = document.querySelector('[aria-label="上一张图片"]')
    const next = document.querySelector('[aria-label="下一张图片"]')
    const gb = r(group), ib = r(img)
    return {
      prevPos: prev && getComputedStyle(prev).position,
      nextPos: next && getComputedStyle(next).position,
      groupH: gb && Math.round(gb.height),
      imgH: ib && Math.round(ib.height),
      // 箭头垂直居中于图内，且 next 贴在右侧（不是在左侧堆叠）
      prevCentered: !!gb && !!r(prev) && Math.abs((r(prev)!.top + 16) - (gb.top + gb.height / 2)) < 2,
      nextOnRight: !!gb && !!r(next) && r(next)!.right > gb.right - 12,
    }
  })
  expect(m.prevPos).toBe('absolute')
  expect(m.nextPos).toBe('absolute')
  expect(m.groupH).toBe(m.imgH) // 箭头不再撑高容器
  expect(m.prevCentered).toBe(true)
  expect(m.nextOnRight).toBe(true)
})

/* ================= 商城页 /shop（阶段二「暖白画廊」两端各自设计） ================= */

async function openShop(page: import('@playwright/test').Page, path: string, vp = DESKTOP) {
  await page.setViewportSize(vp)
  await page.goto(`/#${path}`)
  await expect(page.getByRole('status').filter({ hasText: /^共 \d+ 件/ })).toBeVisible({ timeout: 20_000 })
  await assertCssLive(page)
}

test('桌面 1440 /shop：左侧分类栏与商品画廊真正并排，刊头在画廊上方', async ({ page }) => {
  await openShop(page, '/shop/drinks')
  const nav = await page.getByRole('navigation', { name: '商品分类导航' }).boundingBox()
  const title = await page.getByRole('heading', { level: 1, name: '饮品' }).boundingBox()
  const firstCard = await page.locator('[aria-label^="查看"][role="button"]').first().boundingBox()
  expect(nav && title && firstCard).toBeTruthy()
  // 分类栏整体在画廊左侧
  expect(nav!.x + nav!.width).toBeLessThanOrEqual(firstCard!.x + 4)
  // 刊头在画廊上方，而不是被挤到侧栏里
  expect(title!.y).toBeLessThan(firstCard!.y)
  // 侧栏不得喧宾夺主：直接量它占视口宽度的比例（此前误用 firstCard.x 作分母，
  // 那个值里含页面左内边距，会把 padding 当成侧栏宽度，判据本身是错的）
  expect(nav!.width).toBeLessThan(DESKTOP.width * 0.25)
  // 画廊拿走的宽度必须明显大于侧栏
  expect(firstCard!.width * 2).toBeGreaterThan(nav!.width)
})

test('手机 390 /shop：双列大图、只一个分类导航实例、无横向溢出', async ({ page }) => {
  await openShop(page, '/shop/food/snacks', MOBILE)
  await expect(page.getByRole('navigation', { name: '商品分类导航' })).toHaveCount(1)
  // 窄屏不渲染桌面刊头（两套布局是条件渲染，不是 CSS 隐藏）
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('.grid-cols-2')
    if (!grid) return null
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length
  })
  expect(cols, '窄屏应为双列网格').toBe(2)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, '390px 视口出现横向溢出').toBeLessThanOrEqual(1)
})

test('平板 768 /shop：三列且无横向溢出', async ({ page }) => {
  await openShop(page, '/shop/drinks', TABLET)
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('.sm\\:grid-cols-3') || document.querySelector('[class*="grid-cols-"]')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
  })
  expect(cols).toBeGreaterThanOrEqual(3)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, '768px 视口出现横向溢出').toBeLessThanOrEqual(1)
})

/**
 * 回归锁：价格原先用 brand-600 (#ca8a04)，对白底只有 2.82:1，
 * 连 AA 大字标准 3:1 都不过。阶段二改 brand-700 (#a16207) 后达 4.79:1。
 */
test('商城价格文字对比度过 AA（brand-700，不再是 brand-600 的 2.82:1）', async ({ page }) => {
  await openShop(page, '/shop/drinks')
  const c = await page.evaluate(() => {
    const price = [...document.querySelectorAll('p.tabular-nums')][0]
    const card = price.closest('[role="button"]')!
    const parse = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number)
    const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const fg = parse(getComputedStyle(price).color)
    const bg = parse(getComputedStyle(document.querySelector('.bg-surface')!).backgroundColor)
    const l1 = lum(fg), l2 = lum(bg)
    return { fg: getComputedStyle(price).color, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), card: !!card }
  })
  expect(c.fg).toBe('rgb(161, 98, 7)') // brand-700 #a16207
  expect(c.ratio).toBeGreaterThanOrEqual(4.5)
})

/**
 * 上架商品里「农夫山泉矿泉水」「怡宝矿泉水」各出现两次，只有 spec 能区分。
 * 钉住"同名卡必须给出不同规格行"，防止以后又把规格降级成品名括号附注。
 */
test('同名商品靠独立规格行可区分（规格不得退回品名括号附注）', async ({ page }) => {
  await openShop(page, '/shop/drinks')
  const rows = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[role="button"][aria-label^="查看"]')]
    return cards.map((el) => {
      const h = el.querySelector('h3')
      const spec = h ? h.nextElementSibling : null
      return { name: h?.textContent?.trim() ?? '', spec: spec?.textContent?.trim() ?? '' }
    })
  })
  const dupes = rows.filter((r) => r.name === '农夫山泉矿泉水')
  expect(dupes.length, '本地目录里应有两条同名农夫山泉').toBeGreaterThanOrEqual(2)
  expect(new Set(dupes.map((d) => d.spec)).size).toBe(dupes.length) // 规格两两不同
  expect(dupes.every((d) => d.spec.length > 0)).toBe(true)          // 且都真的渲染出来了
})
