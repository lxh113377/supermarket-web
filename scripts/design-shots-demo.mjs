import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2]; const BASE = process.argv[3] || 'http://127.0.0.1:5183';
fs.mkdirSync(OUT, { recursive: true });
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
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
  await ctx.addInitScript((cart) => { try { localStorage.setItem('sm_cart', JSON.stringify({ ...cart, updatedAt: Date.now() })); } catch {} }, CART);
  const page = await ctx.newPage();
  await page.goto(BASE + '/' + s.url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, s.name + '.png'), fullPage: !!s.full });
  await ctx.close();
}
await browser.close();
console.log('done ' + shots.length);
