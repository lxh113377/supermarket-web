// /print 路由：本站打印页已整体替换为独立的「校园打印」应用（CampusPrint-V1）。
//
// 本组件只剩两件事：① 立刻把浏览器送到该应用；② 跳转被拦时留一个可点的兜底入口
// （老页面那套 3D 场景 / 表单 / 上传逻辑已删除，见 printApp.ts 头部的替换说明）。
import { useEffect, useMemo } from 'react'
import { resolveCampusPrintUrl } from './printApp'

export default function PrintPage() {
  const url = useMemo(() => resolveCampusPrintUrl(), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // replace 而不是 assign：打印页不该留在浏览器历史里 —— 返回键应当回到进入前那一页。
    window.location.replace(url)
  }, [url])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <p className="text-sm text-slate-500" role="status" aria-live="polite">
        正在打开校园打印…
      </p>
      <a className="text-sm text-brand-600 underline" href={url}>
        没有自动跳转？点这里打开校园打印
      </a>
    </main>
  )
}
