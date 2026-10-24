import type { Page } from '@playwright/test'

/**
 * hover 态对比度量测（tests/e2e-visual/hover-contrast.spec.ts 的取数器）。
 *
 * 为什么单独成文件：把量测器与"哪些元素算候选"从 spec 里摘出来，spec 只留断言。
 * 注意 page.evaluate 是**序列化后在页内执行**的，拿不到本文件的外层作用域 —— 所以每个
 * evaluate 的函数体必须自包含（既有 contrastAudit.ts 里那句「必须内联」就是这个意思）。
 * 另有一条死路：把函数转成字符串再在页内 eval 也走不通 —— 生产 CSP 是
 * script-src 'self'（无 unsafe-eval），真构建页面上 eval 直接抛。本仓第一版就栽在这里。
 *
 * 三个量测口径（都是本会话实测踩过的坑，写死在这里免得复犯）：
 *   ① hover 必须真实移动指针（page.mouse.move）：dispatchEvent('mouseenter') 不触发
 *      :hover 伪类，那样量到的一直是默认态，判据会"永远绿"。
 *   ② 背景要沿祖先链合成：这些按钮自身常是 bg-transparent（如商品详情的加减号），
 *      把 rgba(0,0,0,0) 的前三个数当"黑底"算会得出完全错误的比值（本轮第一版探针就把
 *      一处合格的 6.47:1 报成 3.25:1）。半透明底按 src-over 逐层合成到不透明底。
 *      起点是**元素自己**（bgOf(node)），写成 parentElement 会跳过按钮自身底色 —— 那是
 *      本仓另一个真 bug，它把"白字压深底"量成"白字压米白页底"，报出 1.04:1 的荒谬读数。
 *   ③ 先 emulateMedia({ reducedMotion: 'reduce' })：要的是 hover 的**最终**色值，而
 *      transition 期间读到的 computed style 是动画中间帧；等固定时长（上一版等 420ms）
 *      是在猜动画走完，既脆又慢 —— 后台商品页 130 个候选 × 540ms = 70 秒，直接撞 60s
 *      test timeout（本轮 admin 那条就是这么红的，跟对比度无关）。
 *      为什么不用 page.addStyleTag 注入禁 transition 的样式：生产 CSP 是
 *      style-src 'self'（无 unsafe-inline），注入会被**当场拦死**（实测报
 *      "Applying inline style violates the following Content Security Policy directive"）。
 *      而站点自己在 index.css 里有 @media (prefers-reduced-motion: reduce) 把
 *      transition-duration 降到 0.01ms —— 那是外链样式表不受 inline 限制，也是产品支持的
 *      形态（既有 reduced-motion-content.spec.ts 用的就是这个开关）。
 *      这个依赖是脆的，所以 markHoverables 顺手自证：没压住就响亮报错。
 */

export interface HoverMeasure {
  label: string
  ratio: number
  fontSize: string
  bg: string
  ownBg: string
}

/** 给本页所有「hover 会改自身背景」的可见元素打序号标，返回候选个数 */
export async function markHoverables(page: Page): Promise<number> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const r = await page.evaluate(() => {
    let count = 0
    let maxMs = 0
    for (const el of Array.from(document.querySelectorAll('button, a, [role="button"], summary'))) {
      if (!/hover:bg-/.test(String(el.className || ''))) continue
      const box = el.getBoundingClientRect()
      if (box.width < 6 || box.height < 6) continue
      el.setAttribute('data-hv', String(count))
      count += 1
      const d = getComputedStyle(el).transitionDuration
      const num = parseFloat(d)
      if (Number.isNaN(num)) continue
      const ms = d.indexOf('ms') >= 0 ? num : num * 1000
      if (ms > maxMs) maxMs = ms
    }
    return { n: count, maxMs: Math.round(maxMs * 1000) / 1000 }
  })
  // 自证：reduced-motion 没生效 ⇒ 站点那条 @media 可能被删，此时量到的是动画中间帧，
  // 对比度结论不可信。宁可响亮报错，也不要安静地给出假绿/假红。
  if (r.n > 0 && r.maxMs > 1) {
    throw new Error(
      'hover-contrast：reduced-motion 未生效（候选元素实测 transition-duration 最大 ' +
        r.maxMs +
        'ms）。站点 index.css 里那条 @media (prefers-reduced-motion: reduce) 可能被删了，' +
        '此时 hover 读到的是动画中间帧，对比度结论不可信。'
    )
  }
  return r.n
}

/** 把鼠标移到第 idx 个候选上，量 hover 态的前景 / 合成背景对比度 */
export async function measureHoverAt(page: Page, idx: number): Promise<HoverMeasure | null> {
  const el = page.locator('[data-hv="' + idx + '"]').first()
  if ((await el.count()) === 0) return null
  const box = await el.boundingBox()
  if (!box) return null
  // 真实指针移动：dispatchEvent 不触发 :hover
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // transition 已被 reduced-motion 压到 0.01ms ⇒ 只需等一次重绘
  await page.waitForTimeout(60)
  const m = await el.evaluate((node) => {
    const nums = (s: string) => {
      const arr = (s.match(/[\d.]+/g) || []).map(Number)
      if (arr.length < 3) return null
      return { rgb: arr.slice(0, 3) as number[], a: arr.length >= 4 ? arr[3] : 1 }
    }
    const lum = (c: number[]) => {
      const f = (x: number) => { const y = x / 255; return y <= 0.04045 ? y / 12.92 : Math.pow((y + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    // 沿祖先链把半透明背景按 src-over 合成到第一个不透明底（起点含元素自身）
    const bgOf = (start: Element | null): number[] => {
      const stack: Array<{ rgb: number[]; a: number }> = []
      let cur: Element | null = start
      while (cur && cur !== document.documentElement) {
        const v = nums(getComputedStyle(cur).backgroundColor)
        if (v) {
          if (v.a >= 0.995) return v.rgb
          stack.push(v)
        }
        cur = cur.parentElement
      }
      let out = [255, 255, 255]
      for (let k = stack.length - 1; k >= 0; k--) {
        const s = stack[k]
        out = out.map((c, j) => Math.round(s.rgb[j] * s.a + c * (1 - s.a)))
      }
      return out
    }
    const cs = getComputedStyle(node)
    const fg = nums(cs.color)
    const bg = bgOf(node)
    const fa = fg ? fg.a : 1
    // 文字自身半透明（如 opacity-70 的 ¥ 符号）也要合成
    const fgRgb = (fg ? fg.rgb : [0, 0, 0]).map((c, j) => (fa >= 0.995 ? c : Math.round(c * fa + bg[j] * (1 - fa))))
    const a = lum(fgRgb), b = lum(bg)
    return {
      ratio: +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2),
      fontSize: cs.fontSize,
      bg: bg.join(','),
      ownBg: cs.backgroundColor,
    }
  })
  await page.mouse.move(4, 4)
  await page.waitForTimeout(30)
  const label = await el.evaluate((node) =>
    (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28))
  return { label, ...m }
}
