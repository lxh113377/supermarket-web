import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'
import { markHoverables, measureHoverAt } from '../e2e/helpers/hoverContrast'

/**
 * hover 态对比度闸（2026-10-24 新增，跑在生产构建上）。
 *
 * 为什么必须有：contrast 判据扫的是页面**默认渲染态**，而 Tailwind 的 hover:bg-* 只在
 * 指针移上去后才生效 ⇒ 所有「hover 换底」的按钮，其 hover 态文字对比度此前一行都没被
 * 扫过。本轮逐页用眼睛看时连撞两处（都是"改了背景忘了改文字"）：
 *   · ProductsTab「全选(63)」：默认 text-stone-500 压 bg-surface 实测 4.59:1（刚过），
 *     hover 转 bg-gray-100 后掉到 4.36:1 —— 不过 AA；
 *   · CartItem 减号按钮：默认压 bg-gray-50 是 4.59:1，hover 转 gray-100 同样 4.36:1。
 * 两处都已修（hover 时文字同步加深到 stone-700，实测 9.33:1）。
 *
 * 作用面刻意**不限定 gray-100**：src 里 hover:bg-* 共 61 处、19 种底色，其中 40 处没配
 * hover:text-*。哪些真会跌破 4.5:1 不是能推出来的（text-ink 压亮底可能过、text-stone-600
 * 压 gray-200 可能不过），所以让判据自己量 —— 这也正是它比"人工审 class"值钱的地方。
 *
 * 阈值 4.5:1 = WCAG AA 正文。这些文字实测 11~16px，都够不到 18.66px/24px 的大字门槛，
 * 所以按正文口径要求，不降档。
 *
 * 为什么不塞进 contrast.spec.ts：那件的口径是"整页默认态逐元素扫"，含 34 条路由与
 * 一整套滚动/展开逻辑；hover 是另一种触发方式、另一套取数器（要合成祖先背景），
 * 混进去会让那件的失败信息更难归因。一物一判。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

const PAGES: Array<{ name: string; route: string; seedCart?: boolean }> = [
  { name: 'home', route: '/#/' },
  { name: 'shop', route: '/#/shop' },
  { name: 'detail', route: '/#/product/p_46' },
  { name: 'cart', route: '/#/cart', seedCart: true },
  { name: 'assistant', route: '/#/assistant' },
  { name: 'order-query', route: '/#/order-query' },
  { name: 'admin', route: '/#/admin' },
]

test.describe('hover 换底的元素：hover 态文字必须仍过 AA', () => {
  for (const p of PAGES) {
    test(p.name, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      // 购物车要先有加购动作，否则那两处按钮根本不存在（空车只有空态）
      if (p.seedCart) {
        await page.goto('/#/shop')
        await page.waitForTimeout(1300)
        const adds = page.locator('button[aria-label^="添加"]')
        for (let i = 0; i < Math.min(2, await adds.count()); i++) {
          await adds.nth(i).click()
          await page.waitForTimeout(150)
        }
      }
      await page.goto(p.route)
      await page.waitForTimeout(1500)
      const n = await markHoverables(page)
      // 取数面判空：一个候选都没标到 = 选择器失效或页面没渲染，不是"很干净"
      expect(n, p.name + '：没标到任何 hover 换底元素 ⇒ 取数面塌了').toBeGreaterThan(0)
      const bad: string[] = []
      let measured = 0
      for (let i = 0; i < n; i++) {
        const m = await measureHoverAt(page, i)
        if (!m) continue
        measured += 1
        if (m.ratio < 4.5) {
          bad.push('「' + m.label + '」' + m.fontSize + ' 前景压合成底 rgb(' + m.bg + ') = ' + m.ratio + ':1')
        }
      }
      expect(measured, p.name + '：候选 ' + n + ' 个但一个都没量到').toBe(n)
      expect(bad, p.name + ' hover 态有 ' + bad.length + ' 处不过 AA：\n  ' + bad.join('\n  ')).toEqual([])
    })
  }
})
