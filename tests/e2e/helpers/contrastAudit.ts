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
export async function auditPage(page: Page): Promise<{ checked: number; problems: Problem[] }> {

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
    const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 12
    // 承载信息的文字：含中日韩、拉丁字母或数字；纯 emoji/几何符号（装饰）不算
    const INFORMATIVE = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/

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
      const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1])
      let bg = unkey(ranked[0][0])
      // 众数恰好等于文字色（框内几乎只有字、底被字形盖住）⇒ 退到第二众数当底色
      if (near(bg, [fr, fg, fb]) && ranked[1]) bg = unkey(ranked[1][0])

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
