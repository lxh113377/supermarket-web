// /print 路由：把浏览器**就地**交给校园打印应用（CampusPrint-V1）——同源整页导航，绝不跨域跳。
//
// 为什么绝不能跨域跳（2026-10-22 一手事故，老大手机截图）：上一版在顾客端把
//   lxh113377.github.io 用 location.replace 跳到 supermarket-web.pages.dev，微信对这种
//   脚本触发的跨域导航直接弹「即将前往以下网址，无法确认本次跳转是否安全，请使用浏览器访问」，
//   页面上只有「申请恢复访问」——对微信用户等于打印功能整个消失。这是微信的结构性拦截
//   （未备案/未加白域名一律拦），不是调参能修的。所以正确形态只有一个：目标永远是本站同源路径。
//
// 为什么不用 iframe：本站 public/_headers 对 /* 下发 X-Frame-Options: DENY（连同源都不放行），
//   放开它等于给整站放宽防点击劫持面 —— 为省一次同源导航不值。
//
// 应用本体 = public/print/index.html + public/{shared,user}/**（上游源码原样搬入，
// 由 scripts/print-parity.mjs 逐文件对账）；它的 /api 由本站同源反代提供（Pages Functions）。
import { useEffect, useMemo, useState } from 'react'
import { resolveCampusPrintUrl } from './printApp'

export default function PrintPage() {
  const url = useMemo(() => resolveCampusPrintUrl(), [])
  // 本站有没有打印后端可反代？只有 GitHub Pages 这种纯静态托管会没有（无 Functions）。
  // 用一次同源探测得到事实，而不是按主机名猜：主机名清单会漂（本仓 printApp 就为它漂过一次）。
  const [apiState, setApiState] = useState<'unknown' | 'ok' | 'missing'>('unknown')

  useEffect(() => {
    if (typeof window === 'undefined') return
    // assign 而不是 replace：返回键要能回到用户进来时那一页（分类页），而不是被抹掉。
    window.location.assign(url)
  }, [url])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let dead = false
    fetch('/api/public/config', { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      .then((r) => { if (!dead) setApiState(r.status === 404 ? 'missing' : 'ok') })
      .catch(() => { if (!dead) setApiState('missing') })
    return () => { dead = true }
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
      <p className="text-sm text-slate-500" role="status" aria-live="polite">正在打开校园打印…</p>
      {apiState === 'missing' && (
        // 措辞刻意不给链接：本站任何指向别的域名的入口在微信里都会再撞一次拦截页，
        // 而指向本页路径的链接等于没有（用户已经在这页）。只说清能做什么、不能做什么。
        <p className="max-w-sm text-xs leading-relaxed text-amber-700">
          提示：当前入口是纯静态托管，没有打印后端 —— 页面可正常浏览价格与说明，但无法上传文件与下单。
        </p>
      )}
    </main>
  )
}
