// 页面诊断：把「不绘制」这类现象的现场抓下来（控制台/请求失败/计算样式/DOM）。
// 用法：node rust/scripts/diagnose-page.mjs <url> [--wait 3000]

import { chromium } from 'playwright'

const url = process.argv[2]
const at = process.argv.indexOf('--wait')
const waitMs = at >= 0 ? Number(process.argv[at + 1]) : 3000
if (!url) {
  console.error('用法：node scripts/diagnose-page.mjs <url>')
  process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push('console.' + m.type() + ': ' + m.text().slice(0, 300)))
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e && e.message).slice(0, 300)))
page.on('requestfailed', (r) => logs.push('requestfailed: ' + r.url() + ' :: ' + (r.failure() && r.failure().errorText)))
page.on('response', async (r) => {
  const t = r.request().resourceType()
  if (t === 'document' || t === 'script' || t === 'stylesheet') {
    logs.push('response ' + r.status() + ' [' + t + '] ' + r.url().split('/').pop() + ' (' + (r.headers()['content-encoding'] || 'identity') + ')')
  }
})

await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch((e) => logs.push('goto: ' + e.message))
await page.waitForTimeout(waitMs)

const state = await page.evaluate(() => {
  const root = document.getElementById('root')
  const body = document.body
  const cs = getComputedStyle(body)
  const scripts = Array.from(document.querySelectorAll('script')).map((s) => ({ src: s.getAttribute('src'), type: s.getAttribute('type') }))
  const paints = performance.getEntriesByType('paint').map((p) => p.name + '=' + Math.round(p.startTime))
  return {
    rootChildren: root ? root.children.length : -1,
    rootHTMLHead: root ? root.innerHTML.slice(0, 120) : null,
    bodyBg: cs.backgroundColor,
    bodyFont: cs.fontFamily.slice(0, 60),
    scripts,
    paints,
    csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null,
    styleTags: document.querySelectorAll('style').length,
    linkStyles: document.querySelectorAll('link[rel=stylesheet]').length,
    docBytes: document.documentElement.outerHTML.length,
  }
})

console.log('URL ' + url)
console.log('DOM/样式：' + JSON.stringify(state, null, 1))
console.log('事件：')
for (const l of logs) console.log('  ' + l)
await browser.close()
