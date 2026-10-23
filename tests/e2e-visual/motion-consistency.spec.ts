import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 动效一致性闸（2026-10-23 新增，量的是「动效」维度里此前没人管的部分）。
 *
 * 为什么必须有：动效的「高级感」几乎不来自曲线本身多讲究，而来自**全站用同一套**。
 * 一个页面里混进两种 easing，人会读出「这是几个人分别写的」—— 这正是 award 站与
 * 模板站的分水岭。2026-10-23 实测（渲染后 computed style，不是 grep 源码）：
 *   - 五个入场动画里四个用 cubic-bezier(0.16,1,0.3,1)，唯独 animate-fade-in 用裸 ease
 *     （3 处元素受影响）⇒ 本笔已统一；
 *   - 时长全部落在 50ms 网格上（0.15/0.2/0.25/0.3/0.35/0.4/0.5/0.8/1.5/26s）⇒ 本件守住它。
 *
 * 钉两件事：
 *   ① animation-timing-function 只能是「在册曲线」之一。在册 = 代码里已确立的三条贝塞尔
 *      （标准 ease-out / 快出缓收的展示曲线 / 强调曲线）+ linear（跑马灯与骨架屏这类
 *      **匀速循环**必须线性，用缓动会一顿一顿）。裸 ease、ease-in、steps() 一律拒。
 *   ② animation-duration 每个值必须是 50ms 的整数倍。网格本身不是审美要求，是
 *      「不许再随手新增一档」的锁：本轮实测时长之所以干净，正因为只有 4 个动画定义；
 *      一旦有人写 0.22s，网格就破了。
 *
 * **刻意不钉的一件事**（免得判据一上线就红成噪声源）：不钉 transition-property: all。
 * 实测全站 163 处过渡用 all（Tailwind 的 transition-all 默认展开就是它）。all 的代价是
 * 理论上多过渡一些属性、可能触发额外 layout，但它**不是可感知缺陷**，而判红它需要逐个
 * 改成显式属性列表 —— 那是 163 处的大改，属另一件事，本轮只登记不接闸。
 * 若要接，先量清「改成显式属性后视觉无差异」再立，别拿判据逼出一堆无验证的改动。
 */

const VIEWPORT = { width: 1280, height: 900 }

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['admin', '/#/admin'],
]

/** 在册曲线：三条贝塞尔 + linear（匀速循环用） */
const ALLOWED_EASING = new Set([
  'cubic-bezier(0.4, 0, 0.2, 1)',    // Tailwind 默认 ease（material standard）：过渡用
  'cubic-bezier(0.16, 1, 0.3, 1)',   // 入场动画专用：快出缓收，有「落位」感
  'cubic-bezier(0, 0, 0.2, 1)',      // ease-out 强调曲线：路由进度条
  'linear',                           // 跑马灯 / 骨架屏：循环位移必须匀速
])

const DUR_STEP_MS = 50

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Violation { kind: string; value: string; cls: string; txt: string }

async function scan(page: Page): Promise<{ animated: number; violations: Violation[] }> {
  return page.evaluate(([allowed, step]) => {
    const ALLOWED = new Set(allowed as string[])
    /**
     * CSS 多值列表按逗号切分 —— 但**函数内的逗号不是分隔符**。
     * 首版直接 .split(',')，于是 cubic-bezier(0.16, 1, 0.3, 1) 被切成四段（报出
     * 「1」「0.3」「1)」这类碎片，20 处假阳性）—— 那是判据自己的解析缺陷。
     * 按括号深度切。必须内联在 evaluate 里：这段代码序列化后在浏览器执行，
     * 拿不到本文件 Node 侧的外层函数（本仓踩过同形坑）。
     */
    const splitCssList = (value: string): string[] => {
      const out: string[] = []
      let depth = 0
      let cur = ''
      for (const ch of value) {
        if (ch === '(') depth++
        else if (ch === ')') depth = Math.max(0, depth - 1)
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
        cur += ch
      }
      if (cur.trim()) out.push(cur.trim())
      return out
    }
    const out: Array<{ kind: string; value: string; cls: string; txt: string }> = []
    let animated = 0
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el)
      const name = cs.animationName
      if (!name || name === 'none') continue
      animated++
      const cls = String(el.className).slice(0, 44)
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16)
      // 缓动：多值时逐个查（一个元素可挂多个动画）
      for (const f of splitCssList(cs.animationTimingFunction)) {
        if (!ALLOWED.has(f)) out.push({ kind: '缓动不在册', value: f, cls, txt })
      }
      // 时长：逐个查，必须落在网格上
      for (const raw of splitCssList(cs.animationDuration)) {
        const ms = raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000
        if (!isFinite(ms) || Math.abs(ms % step) > 0.001) out.push({ kind: '时长不在网格', value: raw, cls, txt })
      }
    }
    return { animated, violations: out }
  }, [[...ALLOWED_EASING], DUR_STEP_MS] as [string[], number])
}

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

for (const [name, route] of ROUTES) {
  test(name + '：动效曲线在册、时长在 50ms 网格上', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    await login(page)
    const r = await scan(page)
    // 空集守卫：一个动画都没扫到说明页面没渲染，不能读成「动效都合规」
    expect(r.animated, name + ' 一个动画元素都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(0)
    expect(
      r.violations,
      name + ' 有 ' + r.violations.length + ' 处动效离群（扫到 ' + r.animated + ' 个动画元素）：\n' +
        r.violations.slice(0, 10).map((v) => '  ' + v.kind + ' ' + v.value + '  [' + v.cls + '] «' + v.txt + '»').join('\n'),
    ).toEqual([])
  })
}

/**
 * 自证：注入一个「裸 ease + 非网格时长」的动画，两条腿都必须被点名。
 * 没有这条，本判据可能只是「读不到就算合规」的装饰 —— 而本轮实测前，
 * animate-fade-in 用的正是裸 ease，它全站跑了 3 处都没人发现。
 */
test('判据自证：注入裸 ease 与 0.22s 时长，两条腿都必须点名', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const base = await scan(page)
  expect(base.violations.length, '对照组：当前面本应零违例，若非零则下面的断言没有意义').toBe(0)
  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(
      '@keyframes probe-off{from{opacity:.5}to{opacity:1}}' +
        '#mo-probe{position:fixed;left:8px;top:8px;z-index:99999;width:60px;height:20px;' +
        'background:#1c1917;animation:probe-off 0.22s ease both}',
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const d = document.createElement('div')
    d.id = 'mo-probe'
    document.body.appendChild(d)
  })
  await page.waitForTimeout(250)
  const r = await scan(page)
  const hitEase = r.violations.find((v) => v.kind === '缓动不在册' && v.value === 'ease')
  expect(hitEase, '注入裸 ease 没被点名 ⇒ 本判据已失效（曲线面）').toBeTruthy()
  // 同一次注入顺带验网格腿：0.22s = 220ms 不是 50 的倍数
  const hitDur = r.violations.find((v) => v.kind === '时长不在网格' && v.value === '0.22s')
  expect(hitDur, '注入 0.22s（非 50ms 网格）没被点名 ⇒ 本判据已失效（时长面）').toBeTruthy()
})
