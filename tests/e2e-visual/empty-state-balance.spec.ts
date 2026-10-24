import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 空态页垂直平衡闸（2026-10-24 新增，量的是「留白」轴里唯一还没人管的那一档）。
 *
 * 触发事实（一手实测，三档视口）：AI 导购助手是空态页 —— 只有一句开场白 + 六个快捷
 * 问题，全贴在顶栏下面，剩下的全是空白。chips 底到输入框顶的空洞：手机 497px、
 * 桌面 614px、平板 738px，占视口 59% / 68% / 72%。这条页是 AI 导购的入口，空态就是
 * 它的门面，而"首屏过半是空"读起来像页面没加载完。
 *
 * 先说清这条判据量的是什么、不是什么（我第一版差点写错）：
 *   居中**没有消灭空白**，只是把空白从「底部一大坨」重分配成「上下各一半」。
 *   所以「空洞还剩多少 px」不是好判据（居中后 assistant 上下各剩 300px 左右，
 *   按"空洞量"算它还是不合格）。真正的改进是**对称性**：上下余量接近时，空白读起来
 *   像有意的构图；一边倒时读起来像缺内容。所以本判据量「上下余量的不对称度」。
 *
 * 为什么路由要显式列出、不自动扫全站（实测踩出来的）：
 *   同一把尺扫管理端订单/服务页会报「不对称 54% / 49%」，看着像缺陷其实是假阳性 ——
 *   列表页内容贴顶、下方留空是**正确形态**（没人会把商品列表垂直居中）。
 *   所以作用面只能是"整页就是一个空态"的那几条路由，判据必须知道自己在量谁。
 *
 * 阈值：实测三条路由 9% / 8% / 0%（桌面），改回贴顶是 68% —— 上限 25% 既留一倍
 * 余量又不至于形同虚设。
 */

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ['手机390', { width: 390, height: 844 }],
  ['桌面1440', { width: 1440, height: 900 }],
]

/** 整页即空态的路由（新增成员前先确认它不是列表页 —— 列表页贴顶是对的） */
const EMPTY_PAGES: Array<{ name: string; route: string; need: string }> = [
  { name: 'assistant', route: '/#/assistant', need: '你好呀' },
  { name: 'cart-empty', route: '/#/cart', need: '购物车是空的' },
  { name: 'not-found', route: '/#/definitely-not-a-page', need: '页面走丢了' },
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

/**
 * 量视口内内容带的上下余量。
 * 只取**文字叶子与图片**：容器跨整屏，把容器算进去会让余量恒等于 0（我第一版探针
 * 就是这么错的 —— 它给 cart 空态报「上余 29 下余 20」，而截图上明明是居中的）。
 */
async function measureBand(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight
    let top = Infinity
    let bottom = -Infinity
    let leaves = 0
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
      // fixed 元素（吸底栏、悬浮入口）不参与内容带：它们的位置是设计定的，不是流式留白
      if (cs.position === 'fixed') continue
      const isImg = el.tagName === 'IMG'
      const isTextLeaf = el.children.length === 0 && (el.textContent || '').trim().length > 0
      if (!isImg && !isTextLeaf) continue
      const r = el.getBoundingClientRect()
      if (r.width < 6 || r.height < 6) continue
      if (r.bottom < 0 || r.top > vh) continue
      if (r.top < 60) continue // 顶栏不算内容
      top = Math.min(top, r.top)
      bottom = Math.max(bottom, r.bottom)
      leaves += 1
    }
    return { vh, leaves, top: leaves ? top : null, bottom: leaves ? bottom : null }
  })
}

test.describe('空态页上下余量必须平衡（不许一边倒）', () => {
  for (const [vpName, vp] of VIEWPORTS) {
    for (const p of EMPTY_PAGES) {
      test(p.name + ' @' + vpName, async ({ page }) => {
        await page.setViewportSize(vp)
        await page.goto(p.route)
        await page.waitForTimeout(1400)
        // 前置条件：空态文案必须在 —— 否则量的是别的状态（比如加载失败页）
        await expect(page.getByText(p.need).first()).toBeVisible({ timeout: 8_000 })
        const m = await measureBand(page)
        expect(m.leaves, '没量到任何文字叶子 ⇒ 取数面坏了，不是"很平衡"').toBeGreaterThan(0)
        const above = Math.round((m.top as number) - 60)
        const below = Math.round(m.vh - (m.bottom as number))
        const asym = Math.abs(above - below)
        const pct = Math.round((asym / m.vh) * 100)
        console.warn('[empty-balance] ' + p.name + ' @' + vpName + ' 上余=' + above + 'px 下余=' + below + 'px 不对称=' + asym + 'px（' + pct + '% 视口）')
        expect(
          pct,
          p.name + ' 内容带一边倒：上余 ' + above + 'px vs 下余 ' + below + 'px（' + pct + '% 视口）。' +
            '空态页应垂直居中；若这是列表页、贴顶属正常，不要把它加进 EMPTY_PAGES'
        ).toBeLessThanOrEqual(25)
      })
    }
  }
})

/**
 * 自证（负向腿）：造一个"内容全贴顶、下面一大片空"的合成页，本判据必须判它不合格。
 * 没有这条，上面的阈值可能只是"三条路由恰好都居中"的巧合 —— 比如取数面坏了
 * （量到的 top/bottom 是同一个小元素）也会算出很对称的数。
 */
test('判据自证：贴顶空态必须被点名', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/assistant')
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    // 注入两个贴顶文字元素，把内容带拉到顶上（模拟"没居中的空态"）
    const mk = (txt: string, y: number) => {
      const d = document.createElement("div")
      d.textContent = txt
      d.style.cssText = "position:absolute;left:20px;top:" + y + "px;font-size:14px"
      document.body.appendChild(d)
    }
    mk("注入探针甲", 70)
    mk("注入探针乙", 120)
  })
  const m = await measureBand(page)
  const above = Math.round((m.top as number) - 60)
  const below = Math.round(m.vh - (m.bottom as number))
  const pct = Math.round((Math.abs(above - below) / m.vh) * 100)
  console.warn('[empty-balance] 自证：贴顶注入后不对称=' + pct + '% 视口')
  expect(pct, '注入贴顶内容后不对称度仍 ≤25% ⇒ 本判据量不到"一边倒"').toBeGreaterThan(25)
})
