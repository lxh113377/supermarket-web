import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 「减少动效不得丢内容」闸（2026-10-23 新增，量的是「响应式 × 动效」的交叉面）。
 *
 * 一手起因是**我自己上一轮引入的缺陷**：为了让 prefers-reduced-motion 用户不被动效干扰，
 * 全局把 animation-duration 压到 0.01ms、iteration-count 压到 1。这对纯装饰动效是对的，
 * 但首页关键词带（.marquee）的实现是「width:max-content + 父级 overflow:hidden，
 * 内容靠 translateX 动画轮流露出」—— 动画被压到瞬间播完并回到 transform:none 停在起点后，
 * 实测 390px 宽下 5 条公告只有 2 条可见，「微信内即可下单」等 3 条**永久看不见**。
 * 动效不适 ≠ 可以少看信息。修法是把「滚动」这个呈现手段换成「换行铺开」（见 index.css）。
 *
 * 判据口径（刻意只抓「永久不可见」，不抓「此刻不在视野内」）：
 *   对每个 overflow:hidden/clip 的容器，取其中**非 truncate/line-clamp** 的文本叶子，
 *   按文本内容分组（跑马灯这类为无缝循环准备的复制内容会天然成组）；
 *   某组文本的**所有实例**都落在容器可视区之外 ⇒ 该文本永久不可见 ⇒ 违规。
 *   这样既抓得住 bug（复制的第二份也在外面），又不会把「动画正在滚、此刻只露一半」
 *   误判成缺陷 —— 那种情况下至少有一份实例是可见的。
 *   truncate / line-clamp 显式跳过：省略号是明确的截断语义（商品名过长时靠它保行高），
 *   且它没有第二份实例，不属于「靠位移露出内容」这一族。
 *
 * 只在 reduce 面判：no-preference 下动画本来就在滚，位移可见性是时序问题不是缺陷。
 */

const VIEWPORT = { width: 390, height: 844 }

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['category-life', '/#/category/life'],
  ['admin', '/#/admin'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Lost { container: string; text: string; instances: number; positions: string }

async function scanOnce(page: Page): Promise<Lost[]> {
  return page.evaluate(() => {
    const out: Lost[] = []
    const INFO = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/
    const containers = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return false
      const r = el.getBoundingClientRect()
      return r.width > 20 && r.height > 8 && r.top < innerHeight && r.bottom > 0
    })
    for (const box of containers) {
      const br = box.getBoundingClientRect()
      // 收集容器内所有文本叶子，按文本分组
      const groups = new Map<string, Array<{ left: number; right: number; cls: string }>>()
      const walk = (node: Element) => {
        for (const c of Array.from(node.childNodes)) {
          if (c.nodeType === 3) {
            const t = (c.textContent || '').trim()
            if (!t || !INFO.test(t)) continue
            const host = c.parentElement
            if (!host) continue
            const hcls = String(host.className)
            // 省略号截断是明确的设计语义，不属于「靠位移露出内容」这一族
            if (/truncate|line-clamp/.test(hcls) || /truncate|line-clamp/.test(String(box.className))) continue
            const rng = document.createRange()
            rng.selectNodeContents(c)
            const r = rng.getBoundingClientRect()
            if (r.width < 1) continue
            if (!groups.has(t)) groups.set(t, [])
            groups.get(t)!.push({ left: r.left - br.left, right: r.right - br.left, cls: hcls.slice(0, 34) })
          } else if (c.nodeType === 1) walk(c as Element)
        }
      }
      walk(box)
      for (const [text, inst] of groups) {
        // 任一实例与容器可视区有交集 ⇒ 该内容可见（动画中此刻露出也算）
        const anyVisible = inst.some((i) => i.right > 1 && i.left < br.width - 1)
        if (!anyVisible) {
          out.push({
            container: String(box.className).slice(0, 46),
            text: text.slice(0, 22),
            instances: inst.length,
            positions: inst.map((i) => Math.round(i.left) + '..' + Math.round(i.right)).join(' , '),
          })
        }
      }
    }
    return out
  })
}

/** 逐屏滚过整页（含内部滚动容器），合并去重 */
async function scanWithScroll(page: Page): Promise<Lost[]> {
  const seen = new Map<string, Lost>()
  for (let step = 0; step < 8; step++) {
    const more = await page.evaluate((s) => {
      const list: HTMLElement[] = []
      const doc = document.scrollingElement as HTMLElement | null
      if (doc && doc.scrollHeight > doc.clientHeight + 4) list.push(doc)
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el)
        if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) list.push(el)
      }
      let anyMore = false
      for (const el of list) {
        el.scrollTop = s * Math.max(120, el.clientHeight - 40)
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 4) anyMore = true
      }
      return anyMore
    }, step)
    await page.waitForTimeout(240)
    for (const l of await scanOnce(page)) {
      const k = l.container + '|' + l.text
      if (!seen.has(k)) seen.set(k, l)
    }
    if (!more) break
  }
  return Array.from(seen.values())
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
  test(name + '：减少动效下没有任何文本永久不可见', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    await login(page)
    const lost = await scanWithScroll(page)
    expect(
      lost,
      name + ' 在 prefers-reduced-motion 下有 ' + lost.length + ' 段文本永久看不见（靠动画位移露出、动画被压制后就停在视野外）：\n' +
        lost.slice(0, 10).map((l) => '  「' + l.text + '」 容器 [' + l.container + '] 实例 ' + l.instances + ' 个，位置 ' + l.positions).join('\n'),
    ).toEqual([])
  })
}

/**
 * 自证：造一个「靠位移露出内容 + overflow:hidden」的合成容器，
 * 在 reduce 下必须被点名 —— 否则本判据可能只是永远返回空数组的装饰。
 */
test('判据自证：注入一个位移露出的隐藏容器，reduce 下必须被点名', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1100)
  const before = await scanOnce(page)
  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(
      '#rm-probe{position:fixed;left:8px;top:8px;z-index:99999;width:120px;height:28px;overflow:hidden}' +
        '#rm-probe .t{display:flex;width:max-content}' +
        '#rm-probe .t>span{padding:0 8px;white-space:nowrap;flex:none}' +
        // 宽占位把目标文本推到容器视野之外（真实跑马灯就是这种几何：
        // 内容靠 translateX 轮流露出，动画被压制后停在起点，后面的词全在外面）
        '#rm-probe .sp{width:200px}' +
        '#rm-probe .t>span:nth-child(2){width:200px}',
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const box = document.createElement('div')
    box.id = 'rm-probe'
    const track = document.createElement('div')
    track.className = 't'
    // 两份复制（与跑马灯同形）：第二份本来是为无缝循环准备的。
    // 每组都是「宽占位 + 目标词」⇒ 目标词的两个实例都落在 120px 窗口之外，
    // 而占位本身可见 —— 这正是「容器里有内容、但某段文本永远露不出来」的形态。
    for (let d = 0; d < 2; d++) {
      const g = document.createElement('span')
      g.style.display = 'flex'
      const sp = document.createElement('span')
      sp.className = 'sp'
      sp.textContent = '占位' + d
      const s = document.createElement('span')
      s.textContent = '故意藏起来乙'
      g.appendChild(sp)
      g.appendChild(s)
      track.appendChild(g)
    }
    box.appendChild(track)
    document.body.appendChild(box)
  })
  await page.waitForTimeout(250)
  const after = await scanOnce(page)
  const hit = after.filter((l) => l.text.indexOf('故意藏起来') >= 0)
  expect(hit.length, '注入的位移隐藏内容没被点名 ⇒ 本判据已失效（对照：注入前报 ' + before.length + ' 条）').toBeGreaterThan(0)
  expect(hit[0].instances, '应报出两份复制实例都在视野外').toBe(2)
})
