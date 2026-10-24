import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'C:/Users/37533/Desktop/workspace/超市web/_design-qa/v3';
const BASE = 'http://127.0.0.1:5182';
fs.mkdirSync(OUT, { recursive: true });

const CART = { items: [
  { productId: 'p_33', name: '乐事薯片', spec: '40g · 黄瓜味', price: 2.66, quantity: 2 },
  { productId: 'p_46', name: '白象方便面', spec: '桶装', price: 3.66, quantity: 1 },
  { productId: 'p_1', name: '农夫山泉', spec: '550ml', price: 1.5, quantity: 6 },
]};

const DESK = { width: 1440, height: 900 };
const TAB = { width: 834, height: 1112 };
const MOB = { width: 390, height: 844 };

const shots = [];
const pages = [
  { n: 'home', url: '#/', full: true },
  { n: 'shop', url: '#/shop/drinks' },
  { n: 'product', url: '#/product/p_33', full: true },
  { n: 'category', url: '#/category/life', full: true },
  { n: 'service', url: '#/service/express', full: true },
  { n: 'cart', url: '#/cart' },
  { n: 'order-confirm', url: '#/order-confirm' },
  { n: 'order-query', url: '#/order-query' },
  { n: 'order-success', url: '#/order-success' },
  { n: 'payment', url: '#/payment' },
  { n: 'assistant', url: '#/assistant' },
  { n: 'notfound', url: '#/zzz' },
];
const adminTabs = ['看板', '商品', '订单', '服务', '评价'];
for (const vp of [['desk', DESK], ['tab', TAB], ['mob', MOB]]) {
  for (const p of pages) shots.push({ name: p.n + '-' + vp[0], url: p.url, vp: vp[1], full: p.full });
  for (const t of adminTabs) shots.push({ name: 'admin-' + t + '-' + vp[0], url: '#/admin', vp: vp[1], tab: t });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
  await ctx.addInitScript(([cart]) => {
    try {
      localStorage.setItem('sm_cart', JSON.stringify({ ...cart, updatedAt: Date.now() }));
      sessionStorage.setItem('sm_admin_key', 'stub-key');
    } catch {}
  }, [CART]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  try {
    await page.goto(BASE + '/' + s.url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) { errs.push('goto: ' + e.message); }
  await page.waitForTimeout(1200);
  if (s.tab) {
    const b = page.getByRole('tab', { name: s.tab }).first();
    if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(1400); }
  }
  const metrics = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    h: document.body.scrollHeight,
  })).catch(() => ({ overflowX: -1, h: -1 }));
  await page.screenshot({ path: path.join(OUT, s.name + '.png'), fullPage: !!s.full });
  report.push({ shot: s.name, ...metrics, errors: errs.slice(0, 3) });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.filter(r => r.overflowX > 0 || r.errors.length), null, 1));
console.log('shots: ' + report.length);