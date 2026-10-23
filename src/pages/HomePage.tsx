import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CATEGORIES } from '../data/categories'
import { MIN_DELIVERY_AMOUNT } from '../data/deliveryLimits'
import { formatYuan } from '../utils/format'
import { getClosedMessage, getBusinessHoursText } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { IconRobot } from '../components/Icons'
import { prefetchRoute } from '../prefetchBus'

/**
 * 首页（2026-10-22 设计升级）。
 *
 * 版式从「居中三层文字 + 两个装饰圆」换成**柿色封面 + 索引式分类表**，
 * 理由有三条，都不是审美偏好：
 *
 *  1. **对比度**：旧封面是白字压 #eab308（1.92:1，AA 要 4.5:1）。新封面把前景换成墨色
 *     （#1c1917 压柿子黄 = 9.12:1，AAA），品牌色一个像素没改，可读性从"不合格"到"最高级"。
 *     这条是全站通则：柿色底永远配墨字；要白字就走深绿或墨底（见 index.css 顶部）。
 *  2. **层级**：旧页眉题/主标/副标/状态/门槛五件事全是居中白字，靠字号拉开，
 *     眼睛没有落点。现在用「字距 + 字族 + 对齐轴 + 留白」四个维度分开，
 *     标题靠左、状态靠右，一条封面被切成两个阅读区，第一屏就有了主次。
 *  3. **原创性**：切角（cover-clip）、纸纹网点、跑马灯关键词带、01–04 索引数字，
 *     都是这一站独有的形状；换成别的项目名字也成立=没有识别度，这正是我们要避开的。
 *
 * 动效克制在"一次编排好的首屏入场"：封面 → 关键词带 → 索引表逐项上浮，
 * 之后静止。全站已受 prefers-reduced-motion 约束（index.css 顶部全局规则）。
 */

/** 关键词带：内容与"这站能干什么"一致，重复两遍供无缝滚动轨道使用 */
const MARQUEE_WORDS = [
  '零食饮料', '宿舍直送', '校园打印', '起送门槛提前说', '微信内即可下单',
]

/**
 * 封面时钟：单独成组件，让每秒一次的 setState 只重渲染这一小棵树。
 * 直接写在 HomePage 里会让整页（含分类索引与所有卡片）每秒重渲染一遍。
 */
function CoverClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <p className="price-num mt-2 text-2xl font-bold leading-none text-ink tabular-nums">
      {/* 手工补零而不是 toTimeString().slice(0,5)：后者会被上限普查判据
          （scripts/check-limit-provenance.mjs 的「截断型」形状）当成一条截断上限，
          逼着往登记册记一行假账。显示格式化不是上限，不该进那张表。 */}
      {`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
    </p>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const open = useBusinessHours()

  return (
    <div className="page-container paper-grain">
      {/* ── 封面：柿色场 + 墨字，右下角切角破掉四方形 ── */}
      <header
        className={`cover-clip relative overflow-hidden px-6 pt-7 sm:px-10 ${open ? 'pb-12' : 'pb-20'}`}
        style={{ background: 'linear-gradient(155deg, #fde047 0%, #eab308 62%, #ca8a04 100%)' }}
      >
        {/* 顶部品牌色带：黄→橙→深绿，站点视觉链路的唯一真相源（纯装饰，不承载文字） */}
        <span aria-hidden="true" className="brand-bar absolute inset-x-0 top-0 h-1" />

        <div className="relative z-10 mx-auto max-w-5xl">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="eyebrow text-ink/70">江西科技学院 · 宿舍楼下一站</p>
              <h1 className="cover-title mt-3 text-display-lg sm:text-display-xl text-ink">
                江科一站通
              </h1>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-soft/85">
                一站式校园生活服务平台
              </p>
            </div>

            {/* 状态块：营业状态 + 走钟。右对齐，与左侧标题形成两条轴 */}
            <div className="shrink-0 text-right">
              {/* 实底墨胶囊（白字 17.49:1）：8% 半透明墨在黄底上等于没画，
                  状态这件事必须一眼看见，不该让人去猜那块若有若无的底色。 */}
              <div
                className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white"
                role="status"
                aria-live="polite"
              >
                <span
                  aria-hidden="true"
                  className={
                    'h-1.5 w-1.5 rounded-full ' + (open ? 'bg-brand-400 animate-pulse' : 'bg-white/50')
                  }
                />
                {open ? '营业中' : '已打烊'}
              </div>
              <CoverClock />
            </div>
          </div>

          {/* 营业时间 + 起送门槛：两行"规矩"提前讲清，不走到结算才拦人 */}
          <dl className="mt-9 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="eyebrow text-ink/70">营业时间</dt>
              <dd className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                {getBusinessHoursText()}
              </dd>
            </div>
            <div>
              <dt className="eyebrow text-ink/70">起送门槛</dt>
              <dd className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                零食饮料 · 商品总价不满{' '}
                <span className="price-num font-bold text-ink">{formatYuan(MIN_DELIVERY_AMOUNT)}</span>
                &nbsp;不配送
              </dd>
            </div>
          </dl>
        </div>

        {/* 关键词带：唯一的横向动效，hover 暂停（尊重"我在读"这件事）。
            white/55 色带 + 纯墨文字（实测压在最坏底色 #ca8a04 上 11.02:1）。
            旧写法是 ink/55 直接压在封面渐变上 = 2.96–3.4:1，不过正文 4.5:1；
            "淡"这件事改由 12px + 大字距表达，不再靠 alpha —— 色带还顺手把
            关键词从封面里分出来，它本来就是"另一个信息层"而不是一句标语。 */}
        <div className="marquee mt-10 rounded-xl bg-white/55 py-2.5">
          <div className="marquee-track" aria-hidden="true">
            {[0, 1].map(dup => (
              <span key={dup} className="flex shrink-0 items-center">
                {MARQUEE_WORDS.map(w => (
                  <span key={w} className="flex items-center whitespace-nowrap px-4 text-xs font-semibold tracking-[0.08em] text-ink">
                    {w}
                    <span className="ml-4 h-1 w-1 rounded-full bg-ink/25" />
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* 非营业时间提示 */}
      {!open && (
        <div className="relative z-10 mx-auto -mt-7 max-w-5xl px-5 sm:px-10">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/95 p-4 shadow-card backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">非营业时间</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">{getClosedMessage()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 服务索引：编辑式目录列表（一行一条），替代原先四个白卡方块（2026-10-23 老大指「四个大方块好丑」）──
          旧版是四张 bg-white + shadow 的卡片压在暖白页底上 —— 白卡与 #fafaf9 底几乎无对比、
          显得廉价；桌面端靠 margin 交错（lg:-mt-6）想打破四等分，结果看着像没排齐；底部
          「一条灰线 + 进入」是模板站的标准 affordance；emoji 还带一个方形灰托（icon-plate）。
          换成杂志目录那种一行一条：大号序号 + 图标 + 名称/描述 + 弹性引导线 + 进入箭头。
          信息密度更高（四行读完 vs 四张卡各占一大块），扫读路径是一条竖线，也更贴本站
          「纸 + 墨 + 柿」的编辑气质。分隔用 border 不用卡片阴影 —— 留白本身就是分隔。
          用 <Link> 而非 button+onClick：保留原生链接语义（键盘 Tab、右键新标签、读屏链接
          列表），与 RelatedProducts 同口径。
          刻意不加「每类 N 条」：那要把 services.ts（约 10KB）重新拉回首页，破坏 categories.ts
          拆包的本意（见 data/categories.ts 头注）。
          配色口径：序号/描述都用 stone 系（本轮暖化方向），且**必须过对比度**——序号是
          aria-hidden 的装饰，但视力正常用户要看，所以默认用 stone-600（对暖白 7.3:1）而不是
          更浅的 stone-400（只有 2.41:1）；hover 底用 brand-50/70（极淡柿），实测 stone-500 压
          brand-50 有 4.64:1，比压在 gray-100 上（4.36 不足）更安全。── */}
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 pb-28 sm:px-10">
        <div className={`mt-10 flex items-baseline justify-between gap-4 ${open ? '' : 'mt-6'}`}>
          <h2 className="text-display-md text-ink">服务索引</h2>
          <p className="text-xs text-stone-500">四大板块 · 点击进店</p>
        </div>

        <nav aria-label="服务分类" className="enter-stagger mt-4 border-t border-stone-200">
          {CATEGORIES.map((cat, i) => (
            <Link
              key={cat.id}
              to={`/category/${cat.id}`}
              onMouseEnter={() => prefetchRoute('category')}
              onFocus={() => prefetchRoute('category')}
              className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-4 outline-none transition-colors duration-200 hover:bg-brand-50/70 active:bg-brand-100/80 focus-visible:bg-brand-50 sm:-mx-4 sm:gap-5 sm:px-4"
            >
              {/* 序号：编辑式目录的骨架。用 .index-num（Bricolage + tabular-nums），默认 stone-600
                  保证过对比度，hover 转柿色 —— 它是这一行"被指向"的主信号 */}
              <span
                aria-hidden="true"
                className="index-num w-7 shrink-0 text-lg font-bold text-stone-600 transition-colors duration-200 group-hover:text-brand-700 sm:w-9 sm:text-2xl"
              >
                {String(i + 1).padStart(2, '0')}
              </span>

              {/* 图标：裸 emoji，去掉旧版那个方形灰托（icon-plate）—— 托是"卡片时代"的残留，
                  在列表里只显脏 */}
              <span aria-hidden="true" className="shrink-0 text-xl sm:text-2xl">{cat.icon}</span>

              <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-base font-bold tracking-tight text-ink transition-colors duration-200 group-hover:text-brand-800 sm:text-lg">
                  {cat.name}
                </span>
                <span className="truncate text-xs leading-relaxed text-stone-500">{cat.description}</span>
              </span>

              {/* 引导线（dotted leader）：杂志目录把条目连到页码的那根线。桌面才显（移动端
                  宽度不够，硬塞会挤压文字）；hover 由灰转柿，把"可以进去"说成动作 */}
              <span
                aria-hidden="true"
                className="mx-1 hidden flex-1 self-center border-t border-dotted border-stone-300 transition-colors duration-300 group-hover:border-brand-500 sm:block"
              />
              <span className="flex shrink-0 items-center gap-1.5 text-2xs font-semibold tracking-widest text-stone-600 transition-colors duration-200 group-hover:text-brand-700">
                进入
                <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">›</span>
              </span>
            </Link>
          ))}
        </nav>
        {/* 页脚：一条短线 + 极小字，收住首屏不留悬空 */}
        <footer className="mt-16 flex flex-col items-center gap-3">
          <span className="brand-bar h-0.5 w-16 rounded-full opacity-70" aria-hidden="true" />
          <p className="text-2xs tracking-[0.18em] text-stone-500">江西科技学院 · 校园服务平台</p>
        </footer>
      </main>

      {/* AI 导购浮窗：墨底白字（17.49:1），品牌渐变条只作边缘描边 */}
      <button
        onClick={() => navigate('/assistant')}
        onMouseEnter={() => prefetchRoute('assistant')}
        onFocus={() => prefetchRoute('assistant')}
        aria-label="打开 AI 导购助手"
        className="safe-offset-bottom fixed right-4 z-30 flex animate-slide-up items-center gap-2 rounded-full bg-ink py-3 pl-3 pr-4 text-white shadow-float transition duration-200 hover:bg-ink-soft active:scale-[0.95]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500">
          <IconRobot className="h-4 w-4 text-ink" />
        </span>
        <span className="text-xs font-semibold tracking-wide">AI 导购</span>
      </button>
    </div>
  )
}
