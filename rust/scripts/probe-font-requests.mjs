// 补包行为探针：页面到底拉了哪些字体文件。
//
// 关心两件事：
//   ① 首屏（首页）会不会因为补包多下 113 KB —— 补包的 unicode-range 只覆盖「原分包没有、
//      但站内确实用到」的 562 个字；首页文案若含其一就会被拉取（那正是它存在的意义），
//      若不含则一个字节都不下。**必须实测，不能猜**。
//   ② 走到含缺字的页面（商城/管理端）时，补包是否真的 200 到达。
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:5185'
const browser = await chromium.launch({ headless: true })
for (const route of ['/', '/#/shop', '/#/order-query']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const fonts = []
  page.on('response', (r) => { const u = r.url(); if (u.includes('/fonts/')) fonts.push(u.split('/').pop() + '=' + r.status()) })
  await page.goto(base + route, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2500)
  const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 70))
  console.log(route + ' → 字体请求 ' + (fonts.length ? fonts.join(', ') : '（无）') + '｜首屏文本: ' + shown)
  // 再逼一次「缺字路径」：拿两个**原分包没有、补包才有**的字（丁 U+4E01、』 U+300F）去 load 这条字族。
  // 若补包机制成立，浏览器应去取 display-serif-cjk-ext.woff2 —— 这是行为证据，
  // 与 check-font-split 的静态映射（码点 ⇄ 包）互为两腿。
  const before = fonts.length
  await page.evaluate(async () => {
    try { await document.fonts.load('900 40px "CS Display Serif"', '丁』') } catch { /* 失败也要看请求 */ }
  })
  await page.waitForTimeout(1200)
  const added = fonts.slice(before)
  console.log('    缺字路径：' + (added.length ? '新取 ' + added.join(', ') : '未新取字体（补包可能已被缓存或未命中）'))
  await page.close()
}
await browser.close()
