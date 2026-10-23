import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 内容可达性闸（2026-10-23 新增，量的是「响应式」维度里最要命的一档）。
 *
 * 为什么必须有：窄屏 + 吸底栏是本站最容易出事的地方 —— 内容被 fixed 底栏永久压住，
 * 用户**滚到死也点不到那个按钮**，等于下单流程直接断掉。这类缺陷不报错、不红屏，
 * 只在真机上以「我按不到」的形式出现，所以必须有机器口径。
 *
 * 口径（关键，本仓为此踩过两次坑）：
 *   一段文字「不可达」= 在**所有**可达的滚动位置组合下，它要么出屏、要么被别的东西压住。
 *   只要存在一个位置让它完整入镜、且上沿/中心/下沿三点都不被遮 ⇒ 判可达。
 *
 *   为什么必须跨位置取交集：2026-10-23 手工量时，我先在「滚到底」这**一个**位置取样，
 *   报出两处问题（detail 页 sticky 顶栏下、order-confirm 的 fixed 层里），差点当成缺陷
 *   去改 —— 实证扫遍 12 档滚动位置后是 bestVisible=true、worstClip=0，两处都完全可达。
 *   同形错误第九轮也犯过一次（像素分类器把 emoji 的蓝柱子当成默认蓝选区）。
 *   ⇒ 单点取样的几何断言不可信，这正是本件存在的理由。
 *
 *   高度超过视口的块（长段落、整页容器）不参与判定：它几何上不可能整块入镜，
 *   判它「不可达」是噪声。
 *
 * 视口取 320 与 390：320 是微信内最低支持宽度（iPhone SE 一档），390 是主流机型。
 * 1440 不测 —— 宽屏没有吸底栏，且已有 layout.spec.ts 覆盖。
 */

const WIDTHS = [320, 390]

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-confirm', '/#/order-confirm'],
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['admin', '/#/admin'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Unreachable { text: string; cls: string; h: number; reason: string }

/**
 * 页内一次跑完所有采样组合（不在 Node 与浏览器之间往返：往返要每组合一次 IPC，
 * 组合数上百时判据会慢到没人愿意跑）。
 *
 * 三个必须做对的点（本件实测踩出来的，每一个都对应一次假阳性）：
 *  ① **步长自适应**：首版固定采 6 档，而 shop 主滚动容器 span=3762px ⇒ 步长 941px
 *     大于视口 649px，商品名恰好落在两档之间的可见缝隙里（0 档 top=856 出屏、
 *     0.25 档 top=-85 出屏，中间那段其实完全可见）⇒ 报出 14 段假不可达。
 *     现在按「每步滚动量 ≤ 半屏」定档数，保证任何完整入镜的元素必被某一档打到。
 *  ② **横向也要扫**：分类药丸条是 overflow-x-auto（实测横向可滚 184px），只设
 *     scrollTop 就永远看不到「碳酸」这些被横向藏住的药丸。
 *  ③ **逐容器单独推进**（其余归零）：目标是文字，它在 DOM 里位置固定；只要存在
 *     某个容器的某个位置让它入镜即算可达。逐容器扫描覆盖所有单维可达情形，
 *     且口径偏保守 —— 宁可漏报也不误报（误报会让判据失去信任，而漏报只是没抓到）。
 */
async function scan(page: Page): Promise<{ leaves: number; unreachable: Unreachable[] }> {
  return page.evaluate(() => {
    const INFO = /[一-鿿぀-ゟ-ヿA-Za-z0-9]/
    const ownText = (el: Element) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && INFO.test(n.textContent || ''))

    // 枚举滚动容器：document 始终纳入（设 scrollTop 无害），其余要求任一方向真的可滚
    const scrollers: HTMLElement[] = []
    const doc = document.scrollingElement as HTMLElement | null
    if (doc) scrollers.push(doc)
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el)
      const vCan = /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2
      const hCan = /auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2
      if (vCan || hCan) scrollers.push(el)
    }

    const reset = () => { for (const el of scrollers) { el.scrollTop = 0; el.scrollLeft = 0 } }

    /**
     * 采样身份必须是**元素**，不能是文本内容。首版用 textContent 当 key，而
     * 「1L」「¥3.66」这类文本在商品网格里每张卡都出现一次 —— 卡 A 的 1L 此刻可见、
     * 卡 B 的 1L 出屏，合并成同一个 key 后该文本每档都算 bad ⇒ 16/16 误报不可达
     * （实测 scrollTop=0 时确实存在 top=373/bottom=389 完整入镜的那个 1L）。
     * WeakMap 保证同一 DOM 节点跨多次采样拿到同一 id；React 若重建节点则得到新 id，
     * 其计数天然小于总档数 ⇒ 只会漏报不会误报，方向安全。
     */
    const ids = new WeakMap<Element, number>()
    const elById = new Map<number, Element>()
    let seq = 0
    const idOf = (el: Element) => {
      let v = ids.get(el)
      if (v === undefined) { v = seq++; ids.set(el, v) }
      return v
    }

    /**
     * 可见窗口 = 元素 rect ∩ 所有裁切祖先（overflow 非 visible）的 rect。
     *
     * 首版用 range.getBoundingClientRect() 量文字，那是**未裁剪的排版宽度** ——
     * 不受祖先 overflow:hidden 约束。实测管理端商品名：range 宽 122px、而元素
     * 真实可见盒只有 22px（flex 压缩 + truncate/ellipsis），于是中心点落到
     * 隔壁开关按钮上，admin 页 117/205 段被误报成「被遮」。
     * 用元素 rect 求交后同一元素中心点命中的是自己，判读才与用户所见一致。
     */
    const visibleWindow = (el: Element): { top: number; bottom: number; left: number; right: number; height: number; width: number } | null => {
      const r = el.getBoundingClientRect()
      let top = r.top, bottom = r.bottom, left = r.left, right = r.right
      let n: Element | null = el.parentElement
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n)
        // 只对**硬裁切**祖先（hidden / clip）求交。可滚容器（auto / scroll）必须跳过：
        // 它的内容本来就靠滚动逐个露出，元素此刻在窗口外是「待滚动」而不是「被裁掉」。
        // 首版把可滚容器也当裁切盒，于是 service-form 里 top=883（视口下方、需滚过去）
        // 的「备注」求交后高度 -83 ⇒ 误报「被祖先完全裁掉」（实测该元素无任何硬裁切祖先）。
        // body 的 overflow:hidden 是「弹窗打开时锁滚动」的临时态（实测弹窗开着时
        // bodyOY=hidden、bodyH=800，关掉即 visible），不是内容裁切 —— 若把它当裁切盒，
        // 视口下方的表单元素求交归零，会被误报成「被祖先完全裁掉」。跳过 body 这一层。
        const isBody = n === document.body
        const hardClipX = !isBody && (cs.overflowX === 'hidden' || cs.overflowX === 'clip')
        const hardClipY = !isBody && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')
        if (hardClipX || hardClipY) {
          const nr = n.getBoundingClientRect()
          if (hardClipY) { top = Math.max(top, nr.top); bottom = Math.min(bottom, nr.bottom) }
          if (hardClipX) { left = Math.max(left, nr.left); right = Math.min(right, nr.right) }
        }
        n = n.parentElement
      }
      const width = right - left
      const height = bottom - top
      if (width <= 0 || height <= 0) return null   // 被硬裁切祖先完全切掉 ⇒ 真不可见
      return { top, bottom, left, right, width, height }
    }
    const frames = () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))

    /** 一次采样：返回此刻不可见的元素（按 id 索引）+ 参与判定的文字总数 */
    function measure(): { total: number; bad: Map<number, Unreachable> } {
      const bad = new Map<number, Unreachable>()
      let total = 0
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (!ownText(el)) continue
        if (el.closest('[data-decorative="true"]')) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
        const rect = visibleWindow(el)
        if (!rect) {
          // 裁切后零面积：被祖先完全切掉
          total++
          const text0 = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
          const id0 = idOf(el)
          elById.set(id0, el)
          bad.set(id0, { text: text0, cls: String(el.className).slice(0, 40), h: 0, reason: '被祖先完全裁掉' })
          continue
        }
        if (rect.width < 6 || rect.height < 6) continue
        total++
        // 比视口还高的块不参与判定（几何上不可能整块入镜）
        if (rect.height > innerHeight - 2) continue
        const inView = rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5
          && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
        let reason = ''
        if (!inView) {
          reason = rect.top < 0 ? '顶部出屏' : rect.bottom > innerHeight ? '底部出屏'
            : rect.left < 0 ? '左侧出屏' : '右侧出屏'
        } else {
          // 三点采样：上沿 + 中心 + 下沿 —— 只测中心会漏掉「下半截被吸底栏压住」
          const cx = Math.round(rect.left + rect.width / 2)
          const pts: Array<[number, number]> = [
            [cx, Math.round(rect.top + 2)],
            [cx, Math.round(rect.top + rect.height / 2)],
            [cx, Math.round(rect.bottom - 2)],
          ]
          let blocker = ''
          let modal = false
          for (const [x, y] of pts) {
            const hit = document.elementFromPoint(x, y)
            if (!hit) { blocker = 'hit=null'; break }
            if (!(hit === el || el.contains(hit) || hit.contains(el))) {
              blocker = hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 26)
              // 遮挡物若属于「盖住整屏的 fixed 层」⇒ 这是模态弹窗（实测 service-form
              // 的服务须知弹窗：fixed inset-0 z-[80] + 内层 absolute inset-0 bg-black/40）。
              // 模态存在时页面内容整体不可交互是**设计意图**，关掉即可达 —— 本件要抓的是
              // 「用户做任何操作都够不着」，所以模态下豁免，不报。
              const layer = hit.closest('div,section') as HTMLElement | null
              const host = (layer && getComputedStyle(layer).position === 'fixed' ? layer : null)
                || (hit.parentElement && getComputedStyle(hit.parentElement).position === 'fixed' ? hit.parentElement as HTMLElement : null)
              if (host) {
                const hr = host.getBoundingClientRect()
                if (hr.width >= innerWidth * 0.7 && hr.height >= innerHeight * 0.7) modal = true
              }
              break
            }
          }
          if (blocker && !modal) reason = '被遮(' + blocker + ')'
        }
        if (reason) {
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
          const id = idOf(el)
          elById.set(id, el)
          bad.set(id, { text, cls: String(el.className).slice(0, 40), h: Math.round(rect.height), reason })
        }
      }
      return { total, bad }
    }

    // 违规 = 在**每一个**采样位置都不可见 ⇒ 计数法（删除式写法在首档时集合为空，
    // 任何「只在后面几档不可见」的文字根本没机会被排除）
    const badCount = new Map<number, number>()
    const info = new Map<number, Unreachable>()
    let runs = 0
    let leaves = 0

    const tally = (m: { total: number; bad: Map<number, Unreachable> }) => {
      runs++
      leaves = Math.max(leaves, m.total)
      for (const [k, v] of m.bad) {
        badCount.set(k, (badCount.get(k) || 0) + 1)
        if (!info.has(k)) info.set(k, v)
      }
    }

    const sweep = async () => {
      reset()
      tally(measure())
      for (const el of scrollers) {
        const cs = getComputedStyle(el)
        const jobs: Array<'v' | 'h'> = []
        // document.scrollingElement（html）的 computed overflowY 是 visible —— 它的滚动
        // 不由自身 overflow 决定。首版按 overflow 判，home 页因此一档都没扫到
        // （实测 reason 印出「2/2 个采样位置」，而 2 就是 reset + 全底两次兜底）。
        const isDoc = el === (document.scrollingElement as HTMLElement | null)
        if ((isDoc || /auto|scroll/.test(cs.overflowY)) && el.scrollHeight > el.clientHeight + 2) jobs.push('v')
        if ((isDoc || /auto|scroll/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 2) jobs.push('h')
        for (const dir of jobs) {
          const span = dir === 'v' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
          const view = dir === 'v' ? el.clientHeight : el.clientWidth
          // 每步不超过半屏：保证任何完整入镜的元素至少被一档打到
          const steps = Math.max(2, Math.ceil(span / (view * 0.5)))
          for (let s = 1; s <= steps; s++) {
            reset()
            const v = (span * s) / steps
            if (dir === 'v') el.scrollTop = v
            else el.scrollLeft = v
            await frames()
            tally(measure())
          }
        }
      }
      reset()
      for (const e of scrollers) {
        e.scrollTop = e.scrollHeight
        e.scrollLeft = e.scrollWidth
      }
      await frames()
      tally(measure())
    }

    /**
     * 时间维度复查：可达性 = 存在某个（滚动位置 × 时刻）让它可见。
     * 首版只扫滚动位置，于是把跑马灯整条判成不可达（8 段）—— 但它的词条是靠
     * CSS 动画 translateX 轮流进入视野的，**任何滚动位置都改变不了它**。
     * 第九轮实测过：一个完整周期内 5 个词条全部进入过视野 ⇒ 内容其实可达。
     * 所以空间上判为不可达的候选，还要在动画时间轴上再确认一次。
     * 采样间隔 400ms：跑马灯速度约 23px/s（track 1194px/2 份 ÷ 26s），
     * 每 400ms 移动约 9px，而词条宽约 100px ⇒ 覆盖足够密，不会整段跳过。
     */
    const timeConfirm = async (candidates: number[]) => {
      if (!candidates.length) return new Set(candidates)
      reset()
      await frames()
      const still = new Set(candidates)
      const SPAN_MS = 28000   // 覆盖全站最长的 infinite 动画：marquee-track 26s（实测）
      const STEP_MS = 400
      const t0 = performance.now()
      while (still.size && performance.now() - t0 < SPAN_MS) {
        for (const id of Array.from(still)) {
          const el = elById.get(id)
          if (!el || !el.isConnected) { still.delete(id); continue }
          const rect = visibleWindow(el)
          if (!rect) continue
          if (rect.height > innerHeight - 2) { still.delete(id); continue }
          const inView = rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5
            && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
          if (!inView) continue
          const cx = Math.round(rect.left + rect.width / 2)
          let blocked = false
          for (const y of [Math.round(rect.top + 2), Math.round(rect.top + rect.height / 2), Math.round(rect.bottom - 2)]) {
            const hit = document.elementFromPoint(cx, y)
            if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) { blocked = true; break }
          }
          if (!blocked) still.delete(id)   // 这一刻可见 ⇒ 可达，撤销违规
        }
        if (still.size) await new Promise((r) => setTimeout(r, STEP_MS))
      }
      return still
    }

    /**
     * 定向可达性确认：让浏览器自己把它滚进视野，再看是否仍被遮。
     *
     * 为什么需要这一层（替代"穷举滚动组合"）：内容可以嵌在**多层**滚动容器里 ——
     * detail 页的推荐商品卡同时受「主内容纵向容器」与「推荐列表横向容器」控制，
     * 只有两者都滚到位它才入镜。逐容器单独推进（其余归零）覆盖不到这种组合，
     * 于是把完全正常的推荐卡报成不可达（实测「双汇火腿肠」12/12 位置出屏）。
     * 穷举组合是各容器档数的笛卡尔积，会爆炸；而 scrollIntoView 按规范会**依次
     * 滚动所有可滚祖先**，一次就解决整个搜索问题。overflow:hidden 在规范里也算
     * 可编程滚动容器，所以连跑马灯那种也能推进。
     *
     * 语义上也更贴用户视角：用户能做的就是"滚动/点击"，scrollIntoView 就是
     * 「尽力让它可见」。尽力之后仍被压住，才是真正修不掉的缺陷 —— 而 fixed 底栏
     * 不在滚动流里，scrollIntoView 救不了它，正好是我们要抓的那种。
     */
    const scrollIntoViewConfirm = async (candidates: number[]) => {
      let still = candidates
      for (const id of candidates) {
        const el = elById.get(id)
        if (!el || !el.isConnected) { still = still.filter((x) => x !== id); continue }
        el.scrollIntoView({ block: 'center', inline: 'center' })
        await frames()
        const rect = visibleWindow(el)
        if (!rect) continue
        const inView = rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5
          && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
        if (!inView) continue
        const cx = Math.round(rect.left + rect.width / 2)
        let blocked = false
        for (const y of [Math.round(rect.top + 2), Math.round(rect.top + rect.height / 2), Math.round(rect.bottom - 2)]) {
          const hit = document.elementFromPoint(cx, y)
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) { blocked = true; break }
        }
        if (!blocked) still = still.filter((x) => x !== id)   // 滚得过去且不一直被遮 ⇒ 可达
      }
      return still
    }

    /**
     * 聚焦也是一种可达状态（2026-10-23，由 skip link 逼出来的第三层）。
     *
     * 加了「跳到主要内容」之后本件把它判成不可达 —— 而这是**对的判据撞上不全的口径**：
     * skip link 的可见态是 :focus-visible，靠键盘 Tab 唤出，任何滚动位置都叫不出它。
     * 两种处置里选了这个：
     *   · 不该把 skip link 常驻视口 —— 实测那样它的 24×24 中心框会压住返回按钮 9px，
     *     被 touch-targets 判红，而那条判据是对的（占在屏幕上的东西就该被量）；
     *   · 也不该给 skip link 开白名单 —— 白名单会让"任何靠聚焦露出的内容"都逃过检查。
     * 所以补一层"聚焦后重测"：它同时把口径修正得更准（可达 = 存在某个用户可造成的
     * 状态），又保住牙齿 —— 只对**本身可聚焦**的元素尝试，且聚焦后仍要满足
     * "入镜 + 不被遮"才算可达；一个被吸底栏永久压住的可聚焦元素，聚焦后照样被遮，
     * 依然报红（自证腿注入的是不可聚焦的 div，走不到这一层）。
     */
    const focusConfirm = async (candidates: number[]) => {
      let left = candidates
      for (const id of candidates) {
        const el = elById.get(id) as HTMLElement | null
        if (!el || !el.isConnected) { left = left.filter((x) => x !== id); continue }
        const focusable = el.matches('a[href],button,input,select,textarea,[tabindex]')
        if (!focusable) continue
        el.focus()
        await frames()
        if (document.activeElement !== el) continue   // 叫不出焦点 ⇒ 不算可达，维持违规
        const rect = visibleWindow(el)
        if (!rect) continue
        const inView = rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5
          && rect.left >= -0.5 && rect.right <= innerWidth + 0.5
        if (!inView) continue
        const cx = Math.round(rect.left + rect.width / 2)
        let blocked = false
        for (const y of [Math.round(rect.top + 2), Math.round(rect.top + rect.height / 2), Math.round(rect.bottom - 2)]) {
          const hit = document.elementFromPoint(cx, y)
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) { blocked = true; break }
        }
        if (!blocked) left = left.filter((x) => x !== id)
        el.blur()
        await frames()
      }
      return left
    }

    return sweep().then(async () => {
      reset()
      const spatialBad = Array.from(badCount.entries()).filter(([, c]) => c === runs)
      const afterScroll = await scrollIntoViewConfirm(spatialBad.map(([k]) => k))
      const scrolledOk = new Set(afterScroll)
      const afterFocus = await focusConfirm(Array.from(scrolledOk))
      const keep = new Set(afterFocus)
      // 文本级聚合：判据要保护的是「信息可达」，不是「某个 DOM 节点可达」。
      // 同一段文字若有**另一个实例**可达（跑马灯为无缝循环复制的第二份、网格里
      // 同名商品卡），用户照样看到这条信息 ⇒ 不算缺陷。
      const reachableTexts = new Set<string>()
      for (const [k] of spatialBad) if (!keep.has(k)) {
        const e = elById.get(k)
        if (e) reachableTexts.add((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24))
      }
      const spatialKept = spatialBad.filter(([k]) => keep.has(k) && !reachableTexts.has(info.get(k)!.text))
      const stillBad = await timeConfirm(Array.from(keep))
      const unreachable = spatialKept
        .filter(([k]) => stillBad.has(k))
        .map(([k, c]) => {
          const base = info.get(k) as Unreachable
          return { ...base, reason: base.reason + '（' + c + '/' + runs + ' 个滚动位置、且整个动画周期内均不可见）' }
        })
      return { leaves, unreachable }
    })
  })
}

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

for (const w of WIDTHS) {
  for (const [name, route] of ROUTES) {
    test(w + 'px ' + name + '：每段文字都至少在一个滚动位置完整可见（无永久遮挡）', async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 })
      await page.goto(route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1400)
      await login(page)
      const r = await scan(page)
      expect(r.leaves, name + ' 一个文字叶子都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(3)
      expect(
        r.unreachable,
        w + 'px ' + name + ' 有 ' + r.unreachable.length + ' 段文字在所有滚动位置都不可见（共 ' + r.leaves + ' 段）：\n' +
          r.unreachable.slice(0, 10).map((u) => '  「' + u.text + '」 h=' + u.h + 'px [' + u.cls + '] ' + u.reason).join('\n'),
      ).toEqual([])
    })
  }
}

/**
 * 自证：注入一段被 fixed 吸底栏永久压住的文字，必须被点名。
 * 没有这条，本判据可能只是「所有文字都算可见」的装饰 —— 而且它的口径依赖
 * 「跨位置取交集」，交集写错（比如误写成并集）会静默变成永不报错。
 */
test('判据自证：注入被吸底栏永久压住的文字，必须被点名', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const base = await scan(page)
  expect(base.unreachable.length, '对照组：首页本应零不可达文字，若非零则下面的断言没有意义').toBe(0)

  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    // 层级必须是「栏在上、文字在下」：首版把文字 z-index 设得比栏高，
    // 实测 elementFromPoint 命中的是文字自己（hitOwns=true）⇒ 它压根没被遮住，
    // 自证腿于是变成一条永远不成立的空断言。判据的负向半边必须真的造出缺陷形态。
    sheet.replaceSync(
      '#reach-bar{position:fixed;left:0;right:0;bottom:0;height:120px;background:#1c1917;z-index:99999}' +
        '#reach-target{position:fixed;left:12px;bottom:40px;z-index:99998;color:#f5f5f5}',
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const bar = document.createElement('div')
    bar.id = 'reach-bar'
    const t = document.createElement('div')
    t.id = 'reach-target'
    t.textContent = '故意被底栏压住'
    document.body.appendChild(bar)
    document.body.appendChild(t)
  })
  await page.waitForTimeout(250)
  const r = await scan(page)
  const hit = r.unreachable.find((u) => u.text.indexOf('故意被底栏压住') >= 0)
  expect(hit, '注入的永久遮挡文字没被点名 ⇒ 本判据已失效（交集口径或三点采样写错）').toBeTruthy()
})
