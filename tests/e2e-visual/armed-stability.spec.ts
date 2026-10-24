import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 待确认态（armed）尺寸稳定性闸（2026-10-24 新增，量的是「留白 / 版面节奏」轴）。
 *
 * 为什么必须有（一手，且是我自己上一轮引入的缺陷）：内联两步确认靠「换按钮文案」表达
 * 状态，而文案一长就会改几何。实测三档视口（390 / 768 / 1440）：
 *   ① 批量条「删除」armed 成「确认删除 63 个」→ 在 68px 的 flex-1 按钮里折成两行，
 *      而这一排是 flex 容器、align-items 默认 stretch ⇒ 整排四个按钮从 32px 一起撑到
 *      48px。用户点第一下，看到的是一次整行跳动。
 *   ② 批量条「应用」armed 成「确认改为 ¥5.00」→ 按钮 47.7px 涨到 103.1px；这一行是
 *      flex、输入框 flex-1 ⇒ 按钮变宽等量吃掉输入框（264.3 → 208.9px），用户点第一下
 *      会看到自己正在输入的框突然变窄。
 * 两处都已在 ProductsTab 侧修掉（armed 只用两字「确认」；改价按钮两态等字数），
 * 但"改文案 = 改几何"这件事没有任何判据看着 —— 下一次谁给 armed 态加长文案，还会重演。
 *
 * 口径：对每个 armed 控件，量它 idle 与 armed 两态的**盒子尺寸**，要求宽高差 ≤ 0.5px；
 * 同时量它所在那一排（父容器）的高度与同排兄弟按钮的宽度，以及同排输入框的宽度 ——
 * 因为真正的用户感知是「别的东西跟着动了」，只量按钮自己会漏掉 flex 传染这一类。
 * 文字是否溢出按钮矩形也一并量（用 Range 取文字矩形，不用 scrollWidth：.tap-44 的
 * 外扩伪元素会让 scrollWidth 恒大于 clientWidth，那是假阳性，本仓已踩过一次）。
 *
 * ⚠️ 一条关于"断言可达性"的实测教训（立件当天查出来的）：改价那一行的 inputW 断言
 * 排在按钮宽度断言之后，而 flex 子项默认可收缩 ⇒ 任何挤压都先动按钮，inputW 永远
 * 轮不到失败。我连着构造了四种变异（改文案 / 加 margin / 插占位元素）想让 inputW
 * 单独红，全部被宽度断言抢先 —— 这才明白不是变异没做好，而是**那条断言在当前布局
 * 下是死代码**。上一轮我给它写的保留理由（"将来按钮不占 flex 时它才有用"）其实是
 * 给自己留的台阶。
 * 正解不是删断言，而是修产品行为：给按钮加 shrink-0 ⇒ 按钮不再被压到 min-w 下限
 * （那本来就是个缺陷：窄屏 armed 时「应用改价」会被截断），挤压只会落到 flex-1 的
 * 输入框上。加完之后重跑同一个变异，第一个失败的就是 inputW（输入框 240.7 → 207，
 * 按钮恒 71.3）⇒ 断言活了。
 * ⇒ 判据里每条断言都要问一句「它在什么输入下会红」；答不上来就先构造那个输入去验，
 *   验不出来说明要么断言是死的，要么被测面有它够不着的缺陷。
 *
 * 为什么单开一个 spec 而不是塞进 contrast：contrast 的口径是对比度，它抓不到尺寸；
 * 而 layout.spec.ts 是商品详情页专用（名字与夹具都围着它），把管理端批量条塞进去会
 * 稀释那个文件的主题。一物一判：这条只管「换态不许动版面」。
 */

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ['手机390', { width: 390, height: 844 }],
  ['桌面1440', { width: 1440, height: 900 }],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

interface Box { w: number; h: number }
interface Snap {
  self: Box
  textOver: boolean
  rowH: number
  sibW: number[]
  inputW: number | null
}

/** 量一个控件当前态的几何，含它所在排与同排输入框 */
async function snap(page: import('@playwright/test').Page, aria: string | RegExp): Promise<Snap> {
  return page.evaluate((sel) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const all = Array.from(document.querySelectorAll<HTMLElement>('button, [role=button]'))
    const labelOf = (el: Element) => norm(el.getAttribute('aria-label') || el.textContent || '')
    const needle = typeof sel === 'string' ? sel : String(sel).replace(/^\//, '').replace(/\/[a-z]*$/, '').replace(/\\/g, '')
    const re = typeof sel === 'string' ? null : new RegExp(needle)
    const el = all.find((b) => { const l = labelOf(b); return re ? re.test(l) : l === sel })
    if (!el) return null as unknown as Snap
    const r = el.getBoundingClientRect()
    const rg = document.createRange()
    rg.selectNodeContents(el)
    const t = rg.getBoundingClientRect()
    const row = el.parentElement as HTMLElement
    const sibs = Array.from(row.querySelectorAll<HTMLElement>(':scope > button, :scope > [role=button]'))
    const input = row.querySelector('input') || row.parentElement?.querySelector('input') || null
    return {
      self: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      // 文字溢出用 Range 矩形对按钮矩形，不用 scrollWidth（.tap-44 伪元素会污染它）
      textOver: t.right > r.right + 0.5 || t.left < r.left - 0.5 || t.bottom > r.bottom + 0.5 || t.top < r.top - 0.5,
      rowH: +row.getBoundingClientRect().height.toFixed(1),
      sibW: sibs.map((s) => +s.getBoundingClientRect().width.toFixed(1)),
      inputW: input ? +(input as HTMLElement).getBoundingClientRect().width.toFixed(1) : null
    }
  }, aria as string)
}

const fmt = (s: Snap) => `按钮 ${s.self.w}x${s.self.h} 排高 ${s.rowH} 兄弟 ${s.sibW.join('/')} 输入框 ${s.inputW ?? 'n/a'}`

test.describe('armed 态不得改变几何（内联两步确认的版面稳定性）', () => {
  for (const [vpName, vp] of VIEWPORTS) {
    test('管理端批量条：删除与改价两态 @' + vpName, async ({ page }) => {
      await page.setViewportSize(vp)
      await page.goto('/#/admin')
      await page.waitForTimeout(1200)
      // 批量条本身是交互后才出现的（勾选任意商品才有），armed 是二次交互后出现的
      await page.getByRole('button', { name: /全选/ }).click()
      await expect(page.getByLabel('批量删除选中商品')).toBeVisible({ timeout: 5_000 })

      // ---- 批量删除 ----
      const idleDel = await snap(page, '批量删除选中商品')
      expect(idleDel, 'idle 态没量到删除按钮 ⇒ 批量条没出现').not.toBeNull()
      await page.getByLabel('批量删除选中商品').click()
      await expect(page.getByLabel(/确认删除选中的/)).toBeVisible({ timeout: 5_000 })
      const armedDel = await snap(page, /确认删除选中的/)
      expect(armedDel!.self.w, '删除按钮宽度变了：' + fmt(idleDel!)).toBeCloseTo(idleDel!.self.w, 0)
      expect(armedDel!.self.h, '删除按钮高度变了：' + fmt(idleDel!)).toBeCloseTo(idleDel!.self.h, 0)
      expect(armedDel!.rowH, '整排高度被撑动（flex stretch 传染）：' + fmt(idleDel!)).toBeCloseTo(idleDel!.rowH, 0)
      expect(armedDel!.sibW, '同排兄弟按钮宽度被带偏：' + fmt(idleDel!)).toEqual(idleDel!.sibW)
      expect(armedDel!.textOver, 'armed 文案溢出按钮矩形（多半是折行了）').toBe(false)
      // 退回必须用 Esc：点第二下会真的批量删除，批量条消失后量不到改价按钮
      await page.keyboard.press('Escape')
      await expect(page.getByLabel(/确认删除选中的/)).toHaveCount(0, { timeout: 5_000 })

      // ---- 批量改价 ----
      const priceInput = page.getByLabel('批量改价：数字表示统一价，数字加百分号表示打折')
      await priceInput.fill('5')
      const idlePrice = await snap(page, /应用批量改价/)
      await page.getByLabel(/应用批量改价/).click()
      await expect(page.getByLabel(/确认把选中的/)).toBeVisible({ timeout: 5_000 })
      const armedPrice = await snap(page, /确认把选中的/)
      expect(armedPrice!.self.w, '改价按钮宽度变了：' + fmt(idlePrice!)).toBeCloseTo(idlePrice!.self.w, 0)
      expect(armedPrice!.self.h, '改价按钮高度变了：' + fmt(idlePrice!)).toBeCloseTo(idlePrice!.self.h, 0)
      // 同排输入框不许被挤窄：这一行 flex + 输入框 flex-1，按钮变宽等量吃掉它
      expect(armedPrice!.inputW, '同排输入框被挤窄（用户点第一下会看到输入框变短）：' + fmt(idlePrice!)).toBeCloseTo(idlePrice!.inputW!, 0)
      expect(armedPrice!.textOver, '改价 armed 文案溢出按钮矩形').toBe(false)
    })

    test('商品行删除：armed 不换尺寸 @' + vpName, async ({ page }) => {
      await page.setViewportSize(vp)
      await page.goto('/#/admin')
      await page.waitForTimeout(1200)
      const idle = await snap(page, '删除商品')
      expect(idle, '没量到行内删除按钮 ⇒ 商品列表没渲染').not.toBeNull()
      await page.getByLabel('删除商品').first().click()
      await expect(page.getByLabel('确认删除该商品（不可撤销）')).toBeVisible({ timeout: 5_000 })
      const armed = await snap(page, '确认删除该商品（不可撤销）')
      // 行内按钮刻意保持 36px 方形：armed 撑宽会把整行名称/价格往左挤
      expect(armed!.self.w, '行内删除按钮宽度变了（armed 撑宽会挤动整行）：' + fmt(idle!)).toBeCloseTo(idle!.self.w, 0)
      expect(armed!.self.h, '行内删除按钮高度变了：' + fmt(idle!)).toBeCloseTo(idle!.self.h, 0)
      expect(armed!.textOver, '行内 armed 文案「确认」溢出 36px 方框').toBe(false)
      expect(armed!.rowH, '按钮所在排高度被撑动：' + fmt(idle!)).toBeCloseTo(idle!.rowH, 0)
    })
  }
})

/**
 * 自证（成对判据的负向那一半）：把 armed 文案改长，本判据必须红。
 * 没有这条，上面的断言可能只是"两态恰好都一样"的巧合 —— 比如选择器打偏时
 * idle 与 armed 量到的是同一个元素，差值恒为 0，看着全绿其实什么都没量。
 */
test('判据自证：把 armed 文案改长，必须被点名', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEW)
  await page.goto('/#/admin')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /全选/ }).click()
  await expect(page.getByLabel('批量删除选中商品')).toBeVisible({ timeout: 5_000 })
  const idle = await snap(page, '批量删除选中商品')
  // 注入：给删除按钮塞一段长文案（模拟"有人把 armed 文案写长"），并强制折行环境
  await page.getByLabel('批量删除选中商品').click()
  await expect(page.getByLabel(/确认删除选中的/)).toBeVisible({ timeout: 5_000 })
  const mutated = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('button'))
      .find((b) => (b.getAttribute('aria-label') || '').includes('确认删除选中的'))
    if (!el) return null
    el.textContent = '确认删除选中的六十三件商品并且不可撤销请再点一次'
    const r = el.getBoundingClientRect()
    const row = el.parentElement as HTMLElement
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), rowH: +row.getBoundingClientRect().height.toFixed(1) }
  })
  expect(mutated, '注入没生效 ⇒ 本自证腿无效').not.toBeNull()
  // 长文案必然把按钮或整排撑大（哪怕不折行也会撞 flex-1 上限后换行）
  const grew = mutated!.h > idle!.self.h + 0.5 || mutated!.rowH > idle!.rowH + 0.5 || mutated!.w > idle!.self.w + 0.5
  expect(grew, `注入长文案后几何没变（按钮 ${mutated!.w}x${mutated!.h} 排高 ${mutated!.rowH} vs idle ${idle!.self.w}x${idle!.self.h} 排高 ${idle!.rowH}）⇒ 本判据量不到东西`).toBe(true)
})

const MOBILE_VIEW = { width: 390, height: 844 }
