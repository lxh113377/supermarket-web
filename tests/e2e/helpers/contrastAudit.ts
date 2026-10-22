/**
 * 渲染像素对比度审计器（从 tests/e2e-visual/contrast.spec.ts 抽出为共享件）。
 *
 * 为什么抽出来：这套度量此前只服务视觉套件（demo 构建），而 demo 模式下
 * `getDashboardStats` 没有本地实现 ⇒ 管理端「看板」页签只渲染出错误态
 * （实测含字元素 11、canvas 0）。**有数据的管理端从未被任何对比度判据扫过。**
 * 唯一能渲染真数据的路径是 tests/e2e-stub（假密钥 + 假 /web + 真生产包），
 * 所以把审计器抽成两侧共用的一个实现 —— 复制两份必然漂移（本仓反复抓的同族）。
 *
 * 度量口径（为什么不是源码级正则、也不是"直方图 top-2"）见 contrast.spec.ts 头注释。
 * 一句话：前景取 computed color，底色取该元素框内**像素众数**，
 * 这样渐变底 / 祖先背景 / 半透明叠加三类源码扫不到的情况都能量到。
 */
import type { Page } from '@playwright/test'

export interface Problem {
  sel: string; text: string; ratio: number; need: number
  fg: string; size: number; weight: number
  /** 'text' = 文字（正文 4.5 / 大字 3）；'icon' = 功能性图标描边（WCAG 1.4.11 一律 3:1） */
  kind: 'text' | 'icon'
}

/** 页内执行：返回「扫到多少个含字元素」与「不合格清单」 */
async function measureOnce(page: Page): Promise<{ checked: number; problems: Problem[] }> {

  const png = await page.screenshot({ type: 'png' })
  const dataUrl = 'data:image/png;base64,' + png.toString('base64')

  return page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.naturalWidth
    cv.height = img.naturalHeight
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    // 命门：漏了 drawImage，canvas 就是全透明空图 ⇒ 每个元素都采样不到颜色
    // ⇒ 零违规 ⇒ 全站假绿。首版正是如此，被文件末尾的自证用例抓到。
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data

    const parseRGB = (s: string) => {
      const m = s.match(/[\d.]+/g)
      if (!m) return [0, 0, 0, 1]
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])]
    }
    const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a: number[], b: number[]) => {
      const l1 = lum(a), l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b
    const unkey = (k: number) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]
    // 半透明前景（如 text-ink/70）先与底色合成，否则会把"70% 墨压黄底"错算成"墨压黄底"
    const over = (f: number[], a: number, bg: number[]) => f.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))

    /**
     * 底色 = 沿祖先链做 alpha 合成拿到的**计算后实底**（2026-10-23 第三次更正方法）。
     *
     * 为什么像素法还不够：12px 中文两行几乎铺满 284×20 的盒子，盒内根本没有
     * "纯底色像素"可取众数 —— 实测 top-3 是 #98958c/#98968d/#99968d 各占约 3%，
     * 全是文字与底之间的抗锯齿过渡色，据此算出 2.4:1 的假阳性。
     * CSSOM 能精确拿到每层 backgroundColor 与 alpha，与文字密度无关。
     *
     * 只在链上取到**不透明**底时才采信（sure=true）；若一路都是半透明/transparent
     * （背景来自 background-image 渐变，如分类页头部那四组渐变），CSSOM 拿不到颜色，
     * 这时回落到像素法 —— 渐变底只有真实渲染像素能反映。
     */
    const cssBackground = (el: HTMLElement): { rgb: number[]; sure: boolean } => {
      let acc: number[] | null = null
      let a = 0
      let node: HTMLElement | null = el
      for (let d = 0; d < 12 && node; d++) {
        const [r, g, b, al] = parseRGB(getComputedStyle(node).backgroundColor)
        if (al > 0.001) {
          if (!acc) { acc = [r, g, b]; a = al }
          else {
            // 已合成的上层(acc,a) 再盖住本层 [r,g,b]：out = acc*a + lower*(1-a)
            const lower = [r, g, b]
            acc = acc.map((c, i) => Math.round(c * a + lower[i] * (1 - a)))
            a = a + al * (1 - a)
          }
          if (a >= 0.999) return { rgb: acc, sure: true }
        }
        // 祖先带 background-image（Tailwind 的 bg-gradient-* 只设 image，backgroundColor
        // 保持 transparent）⇒ 这一层的颜色 CSSOM 拿不到。若此时累计 alpha 还不够高，
        // 继续往上走就会把"渐变上的白字"错算成"页底上的白字"（实测分类页头部
        // 白字被算成压白 = 1.04:1 假阳性）。此时判定不可信，交回像素法。
        const bgImg = getComputedStyle(node).backgroundImage
        if (bgImg && bgImg !== 'none' && a < 0.9) return { rgb: acc || [255, 255, 255], sure: false }
        node = node.parentElement
      }
      return { rgb: acc || [255, 255, 255], sure: false }
    }
    const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 12
    // 承载信息的文字：含中日韩、拉丁字母或数字；纯 emoji/几何符号（装饰）不算
    const INFORMATIVE = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/

    /**
     * 遮挡判定：被别的元素盖住的文字，用户此刻读的不是它 ⇒ 不扫。
     *
     * 一手触发（2026-10-23）：新增 service-form 路由后一次报出 6 处"不合格"，
     * 逐像素取证才发现页面正开着「温馨提示」模态（Overlay 的 bg-black/40 遮罩），
     * 底下表单的文字是被遮罩压暗后的颜色（白底被量成 #999999、黄按钮透上来变成 #eab308）
     * ⇒ 全是假阳性。判据缺的不是阈值，是"这段文字此刻到底在不在用户眼前"这一层。
     *
     * 做法：取元素中心做 elementFromPoint，命中的若不是自己/自己的后代/自己的祖先，
     * 就说明有别的元素盖在上面。用祖先也算通过是因为 pointer-events:none 的元素
     * 会直接命中到它的容器（那不是遮挡）。
     * 副作用是正向的：弹层、吸底栏、悬浮球盖住的文字都不再被误判，
     * 而"被盖住"这件事本身由 tests/e2e-visual/layout.spec.ts 的几何判据管。
     */
    const isOccluded = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2)
      const cy = Math.round(r.top + r.height / 2)
      if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) return false
      const top = document.elementFromPoint(cx, cy)
      if (!top) return false
      if (top === el || el.contains(top) || top.contains(el)) return false
      return true
    }

    const problems: Problem[] = []
    const seen = new Set<string>()
    let iconChecked = 0

    const candidates = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      /**
       * 装饰豁免走**显式声明**：`data-decorative="true"`（见 404 页水印数字）。
       *
       * 为什么不用 aria-hidden 当代理：aria-hidden 的语义是"对辅助技术隐藏"，
       * 而对比度管的是**肉眼可见**的东西 —— 两者不是一回事。一手漏网正是
       * 订单进度条序号 `<span aria-hidden="true">2</span>`：它对视力正常用户完全可见，
       * 用 gray-500 压 gray-100 = 4.39:1（与本轮已修的 .seg 同形缺陷），
       * 却因为挂了 aria-hidden 而从来没被扫过。
       *
       * 为什么改成"声明式"而不是"取消豁免"：真装饰（404 那个 88px 水印数字）
       * 强行拉到 3:1 就不再是水印了。所以豁免必须有，但只能是**作者显式说的**，
       * 不能由判据从别的属性猜。声明处必须同时写清"为什么它是装饰"。
       */
      if (el.closest('[data-decorative="true"]')) return false
      if (isOccluded(el)) return false
      /**
       * 这里**不再**用 aria-hidden 当"装饰"的代理判据。
       *
       * 原写法是 `if (el.closest('[aria-hidden="true"]')) return false`，把"对辅助技术
       * 隐藏"当成"肉眼看不见"—— 这两件事不是一回事。aria-hidden 的元素对**视力正常的
       * 用户完全可见**，而 WCAG 对比度管的正是肉眼可见的东西。
       * 一手漏网：订单进度条的序号 `<span aria-hidden="true">2</span>` 用 gray-500
       * 压 gray-100 = 4.39:1（与本轮已修的 .seg 同形缺陷），因为这条豁免而从来没被扫过。
       *
       * 现在的口径按**视觉可感知性**筛：真不可见（display/visibility/opacity<0.05）
       * 才不扫；承载信息字符（CJK/拉丁/数字）就算肉眼可见的文字，无论是否 aria-hidden。
       * 纯装饰图形（★ ✓ → ⚠️ 之类不含信息字符的）仍由 INFORMATIVE 那条自然排除。
       */
      if (!INFORMATIVE.test(el.textContent || '')) return false
      // 只看"自己直接持有文字节点"的元素：否则容器会把整片子树混成一张直方图
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && INFORMATIVE.test(n.textContent || ''))
      if (!ownsText) return false
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
      return true
    })

    for (const el of candidates) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const [fr, fg, fb, fa] = parseRGB(cs.color)
      if (fa < 0.05) continue // 完全透明的文字（占位点号那类）不参与判定

      // 图像像素 ⇄ CSS 像素：截图按 deviceScaleFactor 放大，而 rect 永远是 CSS 像素
      const s = cv.width / (document.documentElement.clientWidth || innerWidth)
      const x0 = Math.max(0, Math.round(r.left * s)), y0 = Math.max(0, Math.round(r.top * s))
      const x1 = Math.min(cv.width, Math.round(r.right * s)), y1 = Math.min(cv.height, Math.round(r.bottom * s))
      if (x1 - x0 < 4 || y1 - y0 < 4) continue

      const hist = new Map<number, number>()
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * cv.width + x) * 4
          if (px[i + 3] < 250) continue
          const k = key(px[i], px[i + 1], px[i + 2])
          hist.set(k, (hist.get(k) || 0) + 1)
        }
      }
      if (hist.size === 0) continue
      /**
       * 底色估计（2026-10-23 第二次更正方法）。
       *
       * 首版取"框内像素众数"。两个真实场景把它打穿：
       *   ① 文字密集的小盒子（如 12px 两行提示语）：字形与抗锯齿像素占比很高，
       *      而每个抗锯齿像素颜色都不同 ⇒ 众数落在**混合色**上而不是底色。
       *   ② 底色本身是渐变/被 backdrop-blur 打散（打烊提示压在深绿头部上）：
       *      实测 top-3 是 #98958c / #98968d / #99968d 各占约 3% —— 全是文字与底
       *      之间的过渡色，据此算出 2.4:1 的假阳性（真实底是浅琥珀）。
       *
       * 新口径：**在与文字色明显不同的像素里取众数**。抗锯齿像素位于"文字色⇄底色"
       * 这条线上，所以按到文字色的距离筛掉它们与文字本体，剩下的聚簇就是底色。
       * 距离阈值取最大距离的 60%：既能排除中间调，又不会因为底是渐变而选空。
       * 深底浅字与浅底深字两个方向都成立（判据是"离文字远"，不是"偏亮"）。
       */
      const cssBg = cssBackground(el)
      let bg: number[]
      if (cssBg.sure) {
        bg = cssBg.rgb
      } else {
        // 像素兜底（渐变底）：在与文字色明显不同的像素里取众数。
        // 抗锯齿像素位于"文字色⇄底色"这条线上，按到文字色的距离筛掉它们与文字本体；
        // 阈值取最大距离的 60% —— 既排除中间调，又不会因底是渐变而选空。
        const entries = [...hist.entries()].map(([k, n]) => ({ c: unkey(k), n }))
        const dist = (c: number[]) => Math.abs(c[0] - fr) + Math.abs(c[1] - fg) + Math.abs(c[2] - fb)
        const dmax = entries.reduce((m, e) => Math.max(m, dist(e.c)), 0)
        const far = entries.filter((e) => dist(e.c) > dmax * 0.6)
        const pool = far.length ? far : entries
        bg = pool.sort((a, b) => b.n - a.n)[0].c
      }

      const fontSize = parseFloat(cs.fontSize) || 16
      const weight = parseInt(cs.fontWeight, 10) || 400
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700)
      const need = isLarge ? 3 : 4.5
      const fgFinal = fa >= 0.999 ? [fr, fg, fb] : over([fr, fg, fb], fa, bg)
      const got = ratio(fgFinal, bg)
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
      const dedupe = text + '|' + Math.round(got * 10)
      if (seen.has(dedupe)) continue
      seen.add(dedupe)

      if (got < need) {
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
        problems.push({
          sel: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
          text, ratio: Math.round(got * 100) / 100, need,
          fg: cs.color, size: Math.round(fontSize), weight, kind: 'text' as const,
        })
      }
    }
    /**
     * 功能性图标（svg / 图形字符）的描边对比度。
     *
     * 为什么必须有这一半：本审计器首版**只扫文字节点**，于是 2026-10-23 出现这样一处
     * 漏网 —— AI 导购的「发送」按钮是 brand-bar 渐变底 + 白色 SVG 纸飞机，实测
     * 白描边压渐变中段只有 2.8:1（WCAG 1.4.11 非文本对象要 3:1），25 条用例全绿。
     * "按钮上有没有字"与"按钮上的图形看不看得见"是两件事，前者盖不住后者。
     *
     * 只量**可交互容器内**的图标（button / a / role=button）：纯装饰图标
     * （aria-hidden 且不在控件里）本就不要求对比度，量了只会制造噪音。
     */
    /**
     * 第三类图形：用**文字字符**渲染的图标（★ 评分星、✓、→、✕ 这类）。
     * 它们既不是 svg（逃过图标循环的 `querySelector('svg')`），也不含 CJK/拉丁/数字
     * （逃过文字循环的 INFORMATIVE 正则）—— 于是 2026-10-23 出现漏网：
     * 评价表单里未选中的评分星 `<button role="radio" aria-label="3星"><span aria-hidden="true">★</span></button>`
     * 用 text-gray-400（2.54:1）却扫不到。它是**功能性状态图形**（同"未勾选的
     * checkbox 边框需 3:1"），必须量。
     *
     * 判定口径：控件有可访问名字（aria-label / aria-labelledby），而它自己的可见文字
     * **一个信息字符都没有** ⇒ 它的可见内容就是图形，颜色需 3:1。
     * 有可见文案的按钮（如「发布」）走文字循环按 4.5:1 判，不在此列。
     */
    const hasGlyphIcon = (el: HTMLElement) => {
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      if (!named) return false
      const visible = (el.textContent || '').trim()
      return visible.length > 0 && !INFORMATIVE.test(visible)
    }

    const iconHosts = [...document.querySelectorAll<HTMLElement>('button, a, [role="button"]')].filter((el) => {
      if (el.closest('[data-decorative="true"]')) return false
      if (isOccluded(el)) return false
      const svg = el.querySelector('svg')
      if (!svg && !hasGlyphIcon(el)) return false
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false
      const r = el.getBoundingClientRect()
      return r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    })

    for (const el of iconHosts) {
      const svg = el.querySelector('svg')
      // 图标的实际前景色：svg 取 stroke/fill（currentColor 时回落到控件 color）；
      // 字符图标（★/✓/→）没有 svg，颜色就是控件自身的 color。
      const csEl = getComputedStyle(el)
      let cand = csEl.color
      if (svg) {
        const csSvg = getComputedStyle(svg as unknown as HTMLElement)
        const rawStroke = csSvg.stroke && csSvg.stroke !== 'none' ? csSvg.stroke : ''
        const rawFill = csSvg.fill && csSvg.fill !== 'none' ? csSvg.fill : ''
        cand = [rawStroke, rawFill, csEl.color].find((s) => !!s && !s.includes('current')) || csEl.color
      }
      const [fr, fg2, fb, fa] = parseRGB(cand)
      if (fa < 0.05) continue
      const r = el.getBoundingClientRect()
      const s = cv.width / (document.documentElement.clientWidth || innerWidth)
      const x0 = Math.max(0, Math.round(r.left * s)), y0 = Math.max(0, Math.round(r.top * s))
      const x1 = Math.min(cv.width, Math.round(r.right * s)), y1 = Math.min(cv.height, Math.round(r.bottom * s))
      if (x1 - x0 < 6 || y1 - y0 < 6) continue
      const hist = new Map<number, number>()
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * cv.width + x) * 4
          if (px[i + 3] < 250) continue
          const k = key(px[i], px[i + 1], px[i + 2])
          hist.set(k, (hist.get(k) || 0) + 1)
        }
      }
      if (hist.size === 0) continue
      const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1])
      let bg = unkey(ranked[0][0])
      if (near(bg, [fr, fg2, fb]) && ranked[1]) bg = unkey(ranked[1][0])
      const fgFinal = fa >= 0.999 ? [fr, fg2, fb] : over([fr, fg2, fb], fa, bg)
      const got = ratio(fgFinal, bg)
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
      const dedupe = 'icon|' + label + '|' + Math.round(got * 10)
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      // 非文本对象：WCAG 1.4.11 要求 3:1
      if (got < 3) {
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
        problems.push({
          sel: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
          text: label || '(无标签图标)', ratio: Math.round(got * 100) / 100, need: 3,
          fg: cand, size: Math.round(r.width), weight: 0, kind: 'icon' as const,
        })
      }
      iconChecked++
    }

    return { checked: candidates.length + iconChecked, problems }
  }, dataUrl)
}


/**
 * 滚动覆盖审计（2026-10-23 新增，治「只测首屏」这个系统性盲区）。
 *
 * 一手触发：detail 页的评分星在 top=2177，而视口只有 900/1600 ⇒ 判据一条都没扫到，
 * text-brand-400（压白底 1.53:1）就这么漏了过去。根因不是阈值也不是色值，是
 * 判据只看初始视口 —— 而本站多个页面用内部滚动容器（div.flex-1.overflow-y-auto），
 * 首屏之外的内容与「这页根本没写判据」没区别。实测同页把视口拉到 2600 才看得见 5 颗星。
 *
 * 做法：把所有滚动容器按视口高度逐屏推进，每屏跑一次 measureOnce 并合并
 * （按 text+ratio+need 去重）。MAX_STEPS 防极端长页拖垮判据；结束后还原滚动位置，
 * 避免污染同页后续用例。
 */
const MAX_STEPS = 6

export async function auditPage(page: Page): Promise<{ checked: number; problems: Problem[] }> {
  const seen = new Map<string, Problem>()
  let maxChecked = 0
  for (let step = 0; step < MAX_STEPS; step++) {
    const more = await page.evaluate((s: number) => {
      // 必须内联：page.evaluate 是序列化后在页内执行的，拿不到本文件的外层作用域
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
    await page.waitForTimeout(260)
    const r = await measureOnce(page)
    maxChecked = Math.max(maxChecked, r.checked)
    for (const p of r.problems) {
      const k = [p.text, Math.round(p.ratio * 10), p.need].join("|")
      if (!seen.has(k)) seen.set(k, p)
    }
    if (!more) break
  }
  await page.evaluate(() => {
    const list: HTMLElement[] = []
    const doc = document.scrollingElement as HTMLElement | null
    if (doc) list.push(doc)
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el)
      if (/auto|scroll/.test(cs.overflowY)) list.push(el)
    }
    for (const el of list) el.scrollTop = 0
  })
  return { checked: maxChecked, problems: Array.from(seen.values()) }
}
