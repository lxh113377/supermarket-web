/**
 * 云端模式看板真渲染判据（防线轮 K2）。
 *
 * 跑的是 build:stub 产物（生产构建、IS_CLOUD=true、假 /web），不是 dev server。
 * 三条判据合起来钉的是同一件事：**"测试全绿但线上空白"必须在这里变红**。
 *
 * 反例（必须让本文件变红，已实跑）：把 src/hooks/useDashboardCharts.ts 的
 * `core.use([renderers.CanvasRenderer])` 改回把 lib/chart/*、lib/component/* 深路径模块
 * 一起喂进 use()（这些模块零 export，等价 use(undefined)）→ TypeError 落在无 catch 的
 * async IIFE 里 → canvas 数为 0、pageerror 命中 TypeError。就是 2026-09-24 那起 19 天事故。
 */
import { test, expect, type Page } from '@playwright/test'

/** 四张图的宿主 div（DashboardTab 里带 aria-label 的裸 div，无 role，故用属性选择器而非 getByLabel） */
const CHART_HOSTS = [
  ['营收趋势图', '[aria-label$="营收与订单趋势图"]'],
  ['评价趋势图', '[aria-label="近14天评价趋势图"]'],
  ['分类占比图', '[aria-label="饮品与食品销量占比图"]'],
  ['营收排行图', '[aria-label="热销商品营收排行图"]'],
] as const

/** 非应用级噪声：桩对 SPA 回退外来的资源请求会打 4xx，浏览器自己报 resource load failed */
const CONSOLE_NOISE = [/Failed to load resource/i, /favicon/i, /status of [45]\d\d/i]

let pageErrors: string[] = []
let consoleErrors: string[] = []

test.beforeEach(() => {
  pageErrors = []
  consoleErrors = []
})

/** 收集要在断言之前挂上，否则抛错发生在监听器注册之后就抓不到 */
function watch(page: Page) {
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
}

/** 登录到管理端。桩对任意非空密钥放行，密钥不进日志也不进产物 */
async function login(page: Page) {
  watch(page)
  await page.goto('/#/admin')
  const keyInput = page.getByLabel('管理密钥')
  await expect(keyInput, '云端模式必须出现密钥闸（没静默降级成本地演示模式）').toBeVisible()
  await keyInput.fill('stub-any-key')
  await page.getByRole('button', { name: '进入后台' }).click()
  // 等被等对象的完成态：登录框消失才是"已鉴权"，等自己刚点的 click 不算
  await expect(keyInput).toBeHidden()
}

/** AdminPage 默认 Tab 是「商品」且不持久化（useState('products')），看板必须显式切 */
async function openDashboard(page: Page) {
  await page.getByRole('tab', { name: '看板' }).click()
  await expect(page.locator('[aria-label$="营收与订单趋势图"]'), '看板 Tab 未渲染出趋势图宿主')
    .toHaveCount(1)
}

test.describe('云端模式看板（假桩后端 + 生产构建）', () => {
  test('看板四张图各自渲染出真实 canvas，且全程无未捕获异常', async ({ page }) => {
    await login(page)
    await openDashboard(page)

    for (const [name, selector] of CHART_HOSTS) {
      const host = page.locator(selector)
      await expect(host, `${name}：宿主 div 未挂载`).toHaveCount(1)
      // echarts 是异步 init + 条件渲染后 ensure() 补建，用 poll 而不是固定 sleep
      await expect
        .poll(() => host.locator('canvas').count(), { timeout: 15_000, message: `${name}：宿主内没有 canvas（静默空白回归）` })
        .toBeGreaterThan(0)

      const geo = await host.locator('canvas').first().evaluate((c) => ({
        w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight,
      }))
      // 断言背衬尺寸 > 0 且不小于 CSS 尺寸：这两条在任意 DPR(≥1) 下都成立，
      // 而"真空白"必然是 0 —— 不写死实测的 687×392，那组数随 DPR/视口漂
      expect(geo.w, `${name}：canvas 背衬宽为 0`).toBeGreaterThan(0)
      expect(geo.h, `${name}：canvas 背衬高为 0`).toBeGreaterThan(0)
      expect(geo.w, `${name}：背衬宽 < CSS 宽，尺寸没吃到容器`).toBeGreaterThanOrEqual(geo.cw)
      expect(geo.h, `${name}：背衬高 < CSS 高，尺寸没吃到容器`).toBeGreaterThanOrEqual(geo.ch)
    }

    expect(pageErrors, `未捕获页面异常：${pageErrors.join(' | ')}`).toEqual([])
    const appConsoleErrors = consoleErrors.filter((m) => !CONSOLE_NOISE.some((re) => re.test(m)))
    expect(appConsoleErrors, `应用级 console 错误：${appConsoleErrors.join(' | ')}`).toEqual([])
  })

  test('刷新后凭会话密钥保持登录态，图仍在（钉住桩的 verifyKey 与 Guard 的校验链）', async ({ page }) => {
    await login(page)
    await openDashboard(page)
    await expect(page.locator('[aria-label$="营收与订单趋势图"] canvas').first()).toBeAttached()

    await page.reload()
    watch(page)
    // 先等真实终态：Tab 只在已鉴权后渲染，verifyKey 失败则这里点不到（放前面的 toHaveCount(0)
    // 会在"验证中..."那帧假通过）
    await openDashboard(page)
    await expect(page.getByLabel('管理密钥'), 'verifyKey 通过则不该再弹密钥框').toHaveCount(0)
    await expect
      .poll(() => page.locator('canvas').count(), { timeout: 15_000, message: '刷新后四图未重建' })
      .toBeGreaterThanOrEqual(CHART_HOSTS.length)
  })

  test('未登录时看不到看板数据（管理闸真的在拦）', async ({ page }) => {
    watch(page)
    await page.goto('/#/admin')
    await expect(page.getByLabel('管理密钥')).toBeVisible()
    expect(await page.locator('[aria-label$="营收与订单趋势图"]').count()).toBe(0)
  })
})
