import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 商品行「上架/下架」开关的几何判据 —— 跑生产构建，理由与 layout.spec.ts 相同
 * （dev 下 CSP 把 <style> 整块拦掉，页面零样式，任何 boundingBox 都是假的）。
 *
 * 起因：老大截图报「绿色的按钮中白色的圆圈超出绿色的范围了」。
 * 静态读码解释不了：轨道 w-9 h-5(36×20)、旋钮 w-4 h-4(16) + translate-x-[18px]
 * ⇒ 旋钮占 18..34，两侧各留 2px，数学上不该溢出。所以本文件的第一职责不是"改到绿"，
 * 而是**把这件事量出来**：量不到就如实写"复现不出"，绝不把用户的报障降格成"环境问题"。
 *
 * 判据形态：旋钮的矩形必须完整落在轨道矩形内（四边各留 ≥0）。
 * 这条判据自带反向验证 —— 同文件末尾用变异体证明它真的会红（判据不会红就等于没装）。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

/**
 * CSS 生效证明：不去探某个页面根类（`.bg-surface` 挂在顾客端，管理端根本没有它，
 * 拿它当闸会在真浏览器里恒假），而是直接量**被测量元素自己**的计算样式 ——
 * 轨道底色必须真的是 bg-green-400，否则后面所有 boundingBox 都是没样式的假几何。
 */
async function assertSwitchStyled(page: import('@playwright/test').Page, name: string) {
  const bg = await page.getByRole('button', { name, exact: true }).first()
    .evaluate((b) => {
      const track = b.querySelector(':scope > span') as HTMLElement
      return {
        bg: getComputedStyle(track).backgroundColor,
        radius: getComputedStyle(track).borderRadius,
        display: getComputedStyle(track).display,
      }
    })
  expect(bg.bg, '轨道底色不是 green-400 ⇒ CSS 未生效，几何断言无意义').toBe('rgb(74, 222, 128)')
  expect(bg.radius, 'rounded-full 未生效').toBe('9999px')
  // flex 子项会被 blockify，w-9/h-5 才吃得到；若还是 inline 则宽高一律被忽略
  expect(bg.display, '轨道 display 异常，w-9/h-5 不会生效').not.toBe('inline')
}

interface Box { x: number; y: number; w: number; h: number }

/** 量一个商品行的开关：轨道 = button 的直接子 span，旋钮 = 轨道的直接子 span */
async function measureSwitch(page: import('@playwright/test').Page, name: string): Promise<{ track: Box; knob: Box; enabled: boolean }> {
  const btn = page.getByRole('button', { name, exact: true }).first()
  await expect(btn).toBeVisible()
  const enabled = (await btn.getAttribute('aria-pressed')) === 'true'
  const out = await btn.evaluate((b) => {
    const track = b.querySelector(':scope > span') as HTMLElement
    const knob = track.querySelector(':scope > span') as HTMLElement
    const t = track.getBoundingClientRect()
    const k = knob.getBoundingClientRect()
    return { track: { x: t.x, y: t.y, w: t.width, h: t.height }, knob: { x: k.x, y: k.y, w: k.width, h: k.height } }
  })
  return { ...out, enabled }
}

/** 把实测值印进断言消息：只报"过了/没过"的判据，退化成布尔就看不出量到了什么 */
function insideMsg(r: { track: Box; knob: Box }) {
  const over = {
    right: r.knob.x + r.knob.w - (r.track.x + r.track.w),
    bottom: r.knob.y + r.knob.h - (r.track.y + r.track.h),
    left: r.track.x - r.knob.x,
    top: r.track.y - r.knob.y,
  }
  return `track=${r.track.w.toFixed(1)}x${r.track.h.toFixed(1)}@${r.track.x.toFixed(1)},${r.track.y.toFixed(1)}`
    + ` knob=${r.knob.w.toFixed(1)}x${r.knob.h.toFixed(1)}@${r.knob.x.toFixed(1)},${r.knob.y.toFixed(1)}`
    + ` overflow(right=${over.right.toFixed(2)} bottom=${over.bottom.toFixed(2)} left=${over.left.toFixed(2)} top=${over.top.toFixed(2)})`
}

test('开关旋钮必须完整落在轨道内（上架态与下架态都量）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin')
  await assertSwitchStyled(page, '下架商品')

  // 两态都量，但不靠"目录里恰好有一条下架商品"（默认列表未必有，那样这条判据会因数据而恒缺一半）。
  // 做法：量上架态 → 点一下把它切成下架态 → 再量同一个开关。
  const on = await measureSwitch(page, '下架商品')
  const target = page.getByRole('button', { name: '下架商品', exact: true }).first()
  await target.click()
  const off = await measureSwitch(page, '上架商品')

  const lines: string[] = []
  for (const [label, r] of [['on ', on], ['off', off]] as const) {
    const overRight = r.knob.x + r.knob.w - (r.track.x + r.track.w)
    const overBottom = r.knob.y + r.knob.h - (r.track.y + r.track.h)
    const overLeft = r.track.x - r.knob.x
    const overTop = r.track.y - r.knob.y
    lines.push(`${label} ${insideMsg(r)}`)
    expect(overRight, `${label}: ${insideMsg(r)}`).toBeLessThanOrEqual(0.5)
    expect(overBottom, `${label}: ${insideMsg(r)}`).toBeLessThanOrEqual(0.5)
    expect(overLeft, `${label}: ${insideMsg(r)}`).toBeLessThanOrEqual(0.5)
    expect(overTop, `${label}: ${insideMsg(r)}`).toBeLessThanOrEqual(0.5)
  }
  // 实测值必须出现在结果里，否则"过了"看不出量到了什么
  // （用 console.warn：本仓 lint 的 no-console 只放行 warn/error，且 warning 配额为 0，
  //   写 console.log 会让 `npm run verify` 在 lint 步直接红）
  console.warn(`[switch-geometry]\n  ${lines.join('\n  ')}`)
  // 反向断言：量到的必须是"轨道 36 × 旋钮 16"这个量级，否则是选择器打偏了
  // （打偏时四边溢出恒为 0，上面四条会假绿）
  expect(on.track.w, insideMsg(on)).toBeGreaterThan(30)
  expect(on.knob.w, insideMsg(on)).toBeGreaterThan(10)
  expect(on.knob.w, insideMsg(on)).toBeLessThan(on.track.w)
})

/**
 * 变异体：证明这条判据真的会红。
 *
 * 注入走 CSSOM（`el.style.transform`），不走 `<style>` 元素：本页 CSP 是
 * `style-src 'self'`（无 unsafe-inline），addStyleTag 会被当场拦掉并触发应用级
 * console 错误（实测报 "Applying inline style violates ... CSP"）。
 * CSP 是被测对象的一部分，为了测试放宽它＝把测试写进缺陷里，所以换通道。
 *
 * 另外两件事必须处理，否则变异体"没翻红"会被误读成判据失效：
 *  ① 旋钮带 transition-transform，立刻量＝量到动画中间帧 ⇒ 一并关掉 transition；
 *  ② React 重渲染会换掉 DOM 节点、丢掉 inline 样式 ⇒ 在 poll 里每次重新施加。
 */
test('变异体：把旋钮右移 10px ⇒ 同一把尺必须判红', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin')
  await assertSwitchStyled(page, '下架商品')

  const applyMutation = () => page.getByRole('button', { name: '下架商品', exact: true }).first()
    .evaluate((b) => {
      const knob = (b.querySelector(':scope > span') as HTMLElement).querySelector(':scope > span') as HTMLElement
      knob.style.transition = 'none'
      knob.style.transform = 'translateX(26px)'
      return knob.style.transform
    })

  await expect.poll(async () => {
    expect(await applyMutation()).toBe('translateX(26px)')   // 证明变异真的施加到了当前节点
    const r = await measureSwitch(page, '下架商品')
    return r.knob.x + r.knob.w - (r.track.x + r.track.w)
  }, { message: '变异体本该溢出' }).toBeGreaterThan(0.5)
})
