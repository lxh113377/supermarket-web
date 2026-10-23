/**
 * 跳到主要内容（键盘 / 读屏用户的逃生门）
 *
 * 为什么必须有：没有它，键盘用户从商城页 Tab 进主内容要**先穿过 34 个商品卡按钮**
 * （实测 /#/shop 一屏内交互目标 26 个、整页 73 个）。而搬进来的打印应用
 * （public/print/index.html）本来就有 skip-link —— 外部资产比自研部分更规范，
 * 这个反差本身就是理由。
 *
 * 为什么不用常规写法 <a href="#main-content">：本站是 **HashRouter**，路由地址就住在
 * location.hash 里。实测在 /#/shop/drinks 点一次 href="#main-content-probe" 的锚点，
 * hash 变成 "#main-content-probe" ⇒ react-router 找不到该路由 ⇒ **整页跳到 404**。
 * 所以这里保留 <a>（有 href 才是真链接：可 Tab 到、屏幕阅读器列进"链接"、Enter 生效），
 * 但拦下默认行为，改用 focus() + scrollIntoView 完成跳转 —— 语义与效果都在，
 * 代价是不改地址栏（skip 本来也不该改地址）。
 *
 * tabIndex={-1} 是必需的配套：main 区本身不可聚焦时，focus() 会被浏览器忽略、
 * 读屏不会从那里开始读。各页的 main 容器都已带上这个属性。
 *
 * 隐藏方式用 clip-path + 1px（而不是 display:none / opacity:0）：display:none 的元素
 * 拿不到焦点，skip link 就永远出不来；:focus-visible 时解除隐藏即可正常 Tab 到达。
 */
export default function SkipLink() {
  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 只拦左键默认跳转；中键/新标签打开交给浏览器
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    const target = document.getElementById('main-content')
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start' })
  }
  return (
    <a href="#main-content" onClick={go} className="skip-link">
      跳到主要内容
    </a>
  )
}
