import fs from 'node:fs'
import path from 'node:path'
const pick = (n) => path.join(process.cwd(), '.cache', 'lh', n)
for (const name of ['baseline-s7.json', 'edge-s7.json', 'replica-s7.json']) {
  const file = pick(name)
  if (!fs.existsSync(file)) { console.log(name + ': 缺'); continue }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = j.audits
  const el = a['largest-contentful-paint-element']
  const items = el && el.details && el.details.items ? el.details.items : []
  const node = (items[0] && items[0].items && items[0].items[0] && items[0].items[0].node) || (items[0] && items[0].node) || null
  console.log('== ' + name)
  console.log('  LCP元素: ' + (node ? JSON.stringify({ snippet: String(node.snippet || '').slice(0, 140), selector: node.selector, nodeLabel: node.nodeLabel }) : '—'))
  const paints = a['largest-contentful-paint']
  console.log('  LCP 毫秒: ' + (paints ? Math.round(paints.numericValue) : '—'))
  const reqs = (a['network-requests'] && a['network-requests'].details.items || [])
    .slice()
    .sort((x, y) => (y.transferSize || 0) - (x.transferSize || 0))
    .slice(0, 6)
    .map((i) => (i.url || '').split('/').pop() + '=' + i.transferSize)
  console.log('  传输前 6: ' + reqs.join(', '))
  console.log('  FCP: ' + Math.round(a['first-contentful-paint'].numericValue) + ' / LCP: ' + Math.round(a['largest-contentful-paint'].numericValue))
}
