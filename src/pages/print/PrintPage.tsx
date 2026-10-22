// /print 路由：**不画任何东西**，只做一次同源整页接管 —— 浏览器直接落到应用本体。
//
// 为什么留这个组件：站内入口与历史分享地址都是 hash 路由 `#/print`，删了会落 404。
//   所以这里是一块**零内容**跳板：不渲染文字、不做探测、不显示"正在打开…"或任何说明
//   （老大 2026-10-22 明确要求：打开就是打印页面，不要跳转页、不要提示）。
//
// 目标永远是本站同源真实路径 /print/（= public/print/index.html，上游学生端静态面）。
//   绝不指向外部域名：脚本触发的跨域导航会被微信拦成"无法确认本次跳转是否安全"。
import { useEffect, useMemo } from 'react'
import { resolveCampusPrintUrl } from './printApp'

export default function PrintPage() {
  const url = useMemo(() => resolveCampusPrintUrl(), [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    // replace：不把这块零内容跳板留在历史里，返回键回到用户进来前那一页。
    window.location.replace(url)
  }, [url])
  return null
}
