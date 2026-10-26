// 字体分包的渲染等价性判据：同一段文字，分包前后在浏览器里必须量出**同样的字宽与行高**。
//
// 为什么不用「整页截图逐像素比」当主判据：首页的 hero 照片是每次开屏随机抽的
// （MarketHero 的 pickExhibits），两边的照片本来就不一样；动画也在跑。整页比会把
// 「随机内容差异」混进「字体差异」。所以这里分两层：
//   ① **文字度量**（主判据，确定性）：对每个样本串量 TextMetrics.width / 实际包围盒，
//      分包前后必须逐位相同 —— 字形缺失或换了回退字体会立刻改变这些数；
//   ② **像素比**（辅判据）：只截确定性的文案块（.market-hero-copy），关掉动画后再比，
//      并用浏览器自己的 canvas 做差分（不引任何图像库）。
//
// 用法：node rust/scripts/font-render-parity.mjs --old http://127.0.0.1:5181 --new http://127.0.0.1:5184

import { chromium } from 'playwright'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const oldBase = argOf('--old', 'http://127.0.0.1:5181')
const newBase = argOf('--new', 'http://127.0.0.1:5184')
const viewport = { width: Number(argOf('--width', '1280')), height: Number(argOf('--height', '900')) }

// 样本：覆盖首屏 hero、刊头、分类标题、订单页标题（都是展示体的真实落点）
const samples = [
  { route: '/', selector: '.market-title', label: 'hero 标题' },
  { route: '/', selector: '.showcase-word', label: '刊头「超柿」' },
  { route: '/', selector: '.home-section-heading h2', label: '服务区标题' },
  { route: '/category/life', selector: 'h1', label: '分类页标题' },
  { route: '/order-confirm', selector: 'h2', label: '订单确认标题' },
]

const FONT = '900 48px "CS Display Serif"'

const browser = await chromium.launch({ headless: true })
const measure = async (base) => {
  const page = await browser.newPage({ viewport })
  const out = []
  for (const s of samples) {
    await page.goto(base + '/#' + s.route, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(1500)
    const value = await page.evaluate(async ({ selector, font }) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      // 等这条 family/style 真的就绪（swap 期间可能还是回退字体）
      await document.fonts.load(font, text).catch(() => {})
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      ctx.font = font
      const m = ctx.measureText(text)
      return {
        text,
        width: Math.round(m.width * 100) / 100,
        ascent: Math.round(m.actualBoundingBoxAscent * 100) / 100,
        descent: Math.round(m.actualBoundingBoxDescent * 100) / 100,
        left: Math.round(m.actualBoundingBoxLeft * 100) / 100,
        right: Math.round(m.actualBoundingBoxRight * 100) / 100,
        fontLoaded: document.fonts.check(font, text),
      }
    }, { selector: s.selector, font: FONT })
    out.push({ ...s, ...(value || {}) })
  }
  return out
}

const oldM = await measure(oldBase)
const newM = await measure(newBase)

let fail = 0
console.log('样本（度量必须逐位一致）：')
for (let i = 0; i < samples.length; i += 1) {
  const a = oldM[i]
  const b = newM[i]
  const same = a.width === b.width && a.ascent === b.ascent && a.descent === b.descent && a.left === b.left && a.right === b.right
  if (!same || !b.fontLoaded) fail += 1
  console.log('  ' + (same && b.fontLoaded ? 'PASS' : 'FAIL') + ' ' + samples[i].route + ' ' + samples[i].label +
    '｜文本「' + (b.text || '') + '」')
  console.log('      旧 width=' + a.width + ' asc=' + a.ascent + ' desc=' + a.descent + '｜新 width=' + b.width + ' asc=' + b.ascent + ' desc=' + b.descent +
    '｜字体就绪=' + b.fontLoaded)
}

// 像素比：确定性文案块（关动画）
const shoot = async (base) => {
  const page = await browser.newPage({ viewport })
  // 关动画用 prefers-reduced-motion（站内 CSS 自己有一族 @media (prefers-reduced-motion: reduce) 规则），
  // 而不是注入 <style>：后者会被页面自己的 CSP（style-src 'self'）拦掉 —— 第一版就是这么失败的。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(base + '/#/', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1800)
  await page.waitForTimeout(300)
  const el = await page.$('.market-hero-copy')
  const buf = await el.screenshot()
  await page.close()
  return buf
}
const pngOld = await shoot(oldBase)
const pngNew = await shoot(newBase)
const diff = await (async () => {
  const page = await browser.newPage()
  const res = await page.evaluate(async ({ a, b }) => {
    const load = (dataUrl) => new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
    const ia = await load(a)
    const ib = await load(b)
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, aw: ia.width, ah: ia.height, bw: ib.width, bh: ib.height }
    const c1 = document.createElement('canvas'); c1.width = ia.width; c1.height = ia.height
    const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height
    const x1 = c1.getContext('2d'); const x2 = c2.getContext('2d')
    x1.drawImage(ia, 0, 0); x2.drawImage(ib, 0, 0)
    const d1 = x1.getImageData(0, 0, ia.width, ia.height).data
    const d2 = x2.getImageData(0, 0, ib.width, ib.height).data
    let differing = 0; let maxDelta = 0
    for (let i = 0; i < d1.length; i += 4) {
      const delta = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i+1] - d2[i+1]), Math.abs(d1[i+2] - d2[i+2]), Math.abs(d1[i+3] - d2[i+3]))
      if (delta > 0) differing += 1
      if (delta > maxDelta) maxDelta = delta
    }
    return { width: ia.width, height: ia.height, total: d1.length / 4, differing, maxDelta }
  }, { a: 'data:image/png;base64,' + pngOld.toString('base64'), b: 'data:image/png;base64,' + pngNew.toString('base64') })
  await page.close()
  return res
})()

console.log('\n像素比（.market-hero-copy，关动画；随机照片不在该块内）：')
if (diff.sizeMismatch) {
  fail += 1
  console.log('  FAIL 尺寸不一致：旧 ' + diff.aw + 'x' + diff.ah + ' 新 ' + diff.bw + 'x' + diff.bh)
} else {
  const pct = (diff.differing / diff.total) * 100
  console.log('  ' + (diff.differing === 0 ? 'PASS' : 'FAIL') + ' ' + diff.width + 'x' + diff.height +
    '｜不同像素 ' + diff.differing + '/' + diff.total + '（' + pct.toFixed(4) + '%）｜最大通道差 ' + diff.maxDelta)
  if (diff.differing > 0) fail += 1
}

await browser.close()
console.log(fail === 0 ? '\nGATE-PASS font-render-parity：度量与像素都一致' : '\nGATE-FAIL font-render-parity：' + fail + ' 项')
process.exit(fail === 0 ? 0 : 1)
