import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2]; const BASE = process.argv[3] || 'http://127.0.0.1:5184';
const THEME = process.argv[4] || 'day';
fs.mkdirSync(OUT, { recursive: true });
// 生产 URL 不播种购物车（生产商品 id 形如 p001，播本地 id 会触发价格变动横幅污染截图）
const SEED_CART = BASE.includes('127.0.0.1') || BASE.includes('localhost')
const CART = { items: [
  { productId: 'p_33', name: '乐事薯片', spec: '40g', price: 2.66, quantity: 2 },
  { productId: 'p_46', name: '白象方便面', spec: '桶装', price: 3.66, quantity: 1 },
  { productId: 'p_1', name: '农夫山泉', spec: '550ml', price: 1.5, quantity: 6 } ] };
const shots = [];
for (const [vpName, vp] of [['desk',{width:1440,height:900}],['mob',{width:390,height:844}]]) {
  for (const p of [
    ['home','#/',true],['shop','#/shop/drinks',false],['product','#/product/p_33',true],
    ['cart','#/cart',false],['confirm','#/order-confirm',true],['success','#/order-success',false],
    ['query','#/order-query',false],['category','#/category/life',true],['service','#/service/express',false],
    ['assistant','#/assistant',false],['notfound','#/zzz',false],['admin','#/admin',false],
  ]) shots.push({ name: p[0] + '-' + vpName, url: p[1], vp, full: p[2] });
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
  await ctx.addInitScript(([cart, theme, seed]) => {
    try {
      if (seed) localStorage.setItem('sm_cart', JSON.stringify({ ...cart, updatedAt: Date.now() }));
      localStorage.setItem('sm_theme', theme);
    } catch {}
  }, [CART, THEME, SEED_CART]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(BASE + '/' + s.url, { waitUntil: 'networkidle' }).catch(e => errs.push('goto ' + e.message));
  await page.waitForTimeout(1200);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => -1);
  await page.screenshot({ path: path.join(OUT, s.name + '.png'), fullPage: !!s.full });
  report.push({ shot: s.name, overflowX, errors: errs.slice(0, 3) });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report-' + THEME + '.json'), JSON.stringify(report, null, 1));
const bad = report.filter(r => r.overflowX > 0 || r.errors.length);
console.log(JSON.stringify(bad, null, 1));
console.log('shots ' + report.length + ' theme ' + THEME);
