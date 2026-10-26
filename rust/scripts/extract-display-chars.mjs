// 抽取「展示体中文字」的实际用量（按路由、分首屏/整页）—— 字体分包的依据。
//
// 为什么按「计算样式 + 视口内」抽取而不是人肉列文案：
//   展示体只挂在若干选择器上（src/index.css 的 .font-display-cn / .market-title / ...），
//   而实际落到这条字体链上的文本可能来自数据（商品名、分类名）或组件嵌套；
//   只有问浏览器「这个元素最终用的是不是 CS Display Serif」才与渲染一致。
//
// 用法：node rust/scripts/extract-display-chars.mjs --base http://127.0.0.1:5181 [--routes /,/shop,...] [--json out.json]

import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
// 同时支持 `--name value` 与 `--name=value` 两种写法（第一版只认前者，
// 结果传 `--routes=/a,/b` 时静默回落成默认值，采到的「并集」其实只有首页 —— 这种
// 「参数没生效但脚本照跑」的形态最容易被当成结论，所以这里直接支持两种写法）。
const argOf = (name, fallback) => {
  const inline = args.find((a) => a.startsWith(name + '='))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
// 路由表优先从环境变量读：实测经 ops_bash 传 `--routes "/a,/b"` 时，参数会被前置一段
// 宿主路径（argv 里混进 bash shim 目录），采出来的「并集」其实只覆盖了一半路由 ——
// 「参数没生效但脚本照跑」是最容易被当成结论的形态，所以这里给一条不受 argv 影响的入口。
// 路由表从 `XR_ROUTES` 读，且必须是 **JSON 数组**（形如 ["/","/shop"]）。
// 为什么不用「逗号分隔的裸串」：MSYS/Git-Bash 会把「以 / 开头的参数或环境变量值」当成
// POSIX 路径改写成 Windows 路径（实测 `FOO='/a,/b'` 进到 node 里变成
// `C:/Users/.../bash-win32-x64/a,/b`），于是第一个路由会被换成宿主目录 ——
// 以 `[` 开头的 JSON 不发生这种改写。
const envRoutes = process.env.XR_ROUTES || ''
const base = argOf('--base', process.env.SM_BASE || 'http://127.0.0.1:5181')
const jsonOut = argOf('--json', process.env.SM_JSON_OUT || '')
const routesArg = envRoutes || argOf('--routes', '')
const routes = routesArg.trim().startsWith('[')
  ? JSON.parse(routesArg)
  : routesArg.split(',').map((s) => s.trim()).filter(Boolean)
const viewport = { width: Number(argOf('--width', '390')), height: Number(argOf('--height', '844')) }
if (!routes.length) routes.push('/')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

const collect = () => page.evaluate(() => {
  const isDisplay = (el) => {
    const ff = getComputedStyle(el).fontFamily || ''
    return ff.includes('CS Display Serif')
  }
  const textOf = (el) => {
    let out = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out += node.nodeValue || ''
      else if (node.nodeType === 1) out += textOf(node)
    }
    return out
  }
  const inViewport = (el) => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
  }
  const firstScreen = new Set()
  const wholePage = new Set()
  const hits = new Set()
  for (const el of document.querySelectorAll('*')) {
    if (!isDisplay(el)) continue
    const text = textOf(el)
    if (!text.trim()) continue
    hits.add(el.tagName.toLowerCase() + '.' + String(el.className).split(/\s+/)[0])
    for (const ch of text) {
      if (ch.charCodeAt(0) < 128 && !/[0-9A-Za-z]/.test(ch)) continue
      wholePage.add(ch)
      if (inViewport(el)) firstScreen.add(ch)
    }
  }
  return { firstScreen: [...firstScreen].sort(), wholePage: [...wholePage].sort(), hits: [...hits].sort() }
})

const report = {}
const firstUnion = new Set()
const wholeUnion = new Set()
console.log('路由清单：' + JSON.stringify(routes))
for (const route of routes) {
  // 关键：必须等 React 真把首屏画出来。第一版只 waitForTimeout，结果除一个路由外全采到 0 字符
  // —— 那不是「该路由不用展示体」，而是「页面还没渲染完」（本机首屏 JS 执行要 1~3 s）。
  await page.goto(base + '/#' + route, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction(() => {
    const root = document.getElementById('root')
    return root && root.children.length > 0
  }, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const r = await collect()
  report[route] = r
  for (const ch of r.firstScreen) firstUnion.add(ch)
  for (const ch of r.wholePage) wholeUnion.add(ch)
  console.log('  ' + route.padEnd(16) + ' 首屏 ' + String(r.firstScreen.length).padStart(3) + ' 种｜整页 ' + String(r.wholePage.length).padStart(3) + ' 种｜元素 ' + r.hits.slice(0, 4).join(' '))
}

const fs = [...firstUnion].sort()
const wp = [...wholeUnion].sort()
console.log('\n各路由首屏并集：' + fs.length + ' 种')
console.log('  ' + fs.join(''))
console.log('全部路由整页并集：' + wp.length + ' 种')
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ base, viewport, routes, perRoute: report, firstScreenUnion: fs, wholePageUnion: wp }, null, 2) + '\n')
  console.log('已写 ' + jsonOut)
}
await browser.close()
