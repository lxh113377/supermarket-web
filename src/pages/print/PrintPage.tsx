// /print 路由：把浏览器**就地**交给校园打印应用（CampusPrint-V1）——同源整页导航，绝不跨域跳。
//
// 为什么绝不能跨域跳（2026-10-22 一手事故，老大手机截图）：上一版在顾客端把
//   lxh113377.github.io 用 location.replace 跳到 supermarket-web.pages.dev，微信对这种
//   脚本触发的跨域导航直接弹「即将前往以下网址，无法确认本次跳转是否安全，请使用浏览器访问」，
//   页面上只有「申请恢复访问」——对微信用户等于打印功能整个消失。这是微信的结构性拦截
//   （未加白域名一律拦），不是调参能修的。所以正确形态只有一个：目标永远是本站同源路径。
//
// 为什么不用内嵌框架：本站 public/_headers 对 /* 下发 X-Frame-Options: DENY（连同源都不放行），
//   放开它等于给整站放宽防点击劫持面 —— 为省一次同源导航不值。
//
// 探测先于导航（2026-10-22 一手：实测 github.io 上 /api 全 404）：
//   GitHub Pages 是纯静态托管、没有 Functions ⇒ 那边既没有 /api 也无从反代。
//   若照样自动导航，用户会落进一个「暂时无法读取服务配置 / 重试」的死页 ——
//   比不跳转更糟。所以先探一次同源 /api：有后端才接管，没有就在站内把事实讲清楚。
import { useEffect, useMemo, useState } from 'react'
import { classifyApiProbe, resolveCampusPrintUrl } from './printApp'

type ApiState = 'unknown' | 'has-backend' | 'no-backend'

export default function PrintPage() {
  const url = useMemo(() => resolveCampusPrintUrl(), [])
  const [api, setApi] = useState<ApiState>('unknown')

  useEffect(() => {
    if (typeof window === 'undefined') return
    let dead = false
    fetch('/api/public/config', { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      .then((r) => { if (!dead) setApi(classifyApiProbe(r.status)) })
      // 网络异常按「有后端但这次没取到」处理：交给应用自己的重试入口，
      // 不因一次抖动就把用户挡在打印页外面（那比暂时不可用更糟）。
      .catch(() => { if (!dead) setApi('has-backend') })
    return () => { dead = true }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // assign 而不是 replace：返回键要能回到用户进来时那一页（分类页）。
    if (api === 'has-backend') window.location.assign(url)
  }, [api, url])

  if (api === 'no-backend') {
    // 刻意不给任何指向别的域名的链接：本站指向外部域名的入口在微信里会再撞一次同一个拦截页。
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <h1 className="text-lg font-bold text-gray-900">校园打印 · 说明</h1>
        <p className="max-w-sm text-sm text-gray-600">A4 黑白打印，仅配送本栋宿舍。</p>
        <p className="max-w-sm text-sm leading-relaxed text-gray-500">
          这个入口是纯静态托管（GitHub Pages），平台不能运行打印后端，
          所以在这里只能看说明、不能上传文件与下单 —— 换浏览器也一样，不是浏览器的问题。
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-gray-400">
          计价规则：A4 黑白，单面每张 0.50 元、实际双面每张 0.90 元（双面奇数尾张按 0.50 元）；
          整单内容页数含份数限 1–99 页，仅配送本栋宿舍。
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-gray-400">
          可下单的入口在 <span className="font-mono">supermarket-web.pages.dev/print/</span>
          （此处刻意不做成链接：微信里点跨域链接会再弹一次安全提示，复制粘贴反而更快）。
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
      <p className="text-sm text-slate-500" role="status" aria-live="polite">
        {api === 'unknown' ? '正在检查打印服务…' : '正在打开校园打印…'}
      </p>
    </main>
  )
}
