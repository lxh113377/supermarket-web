// 从 src/data/products-seed.ts 提取分类与商品，生成 db/seed.sql
// 用法：node db/gen-seed.mjs  →  写 db/seed.sql
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const file = path.resolve(__dirname, '../src/data/products-seed.ts')
const src = fs.readFileSync(file, 'utf8')
  .replace(/^\s*import type .*$/m, '')
  .replace(/export const/g, 'const')
  .replace(/: Category\[\]/g, '')
  .replace(/: SeedProduct\[\]/g, '')
const { categories, products } = new Function(src + '\nreturn { categories, products };')()

function esc(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v) || typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

const lines = []
for (const c of categories) {
  lines.push(
    `INSERT INTO categories (_id, name, type, "order", subcategories) VALUES (${esc(c._id)}, ${esc(c.name)}, ${esc(c.type)}, ${esc(c.order)}, ${esc(c.subcategories)});`
  )
}
for (const p of products) {
  const _id = 'p' + String(p.order).padStart(3, '0')
  lines.push(
    `INSERT INTO products (_id, name, spec, price, subcategories, enabled, "order") VALUES (${esc(_id)}, ${esc(p.name)}, ${esc(p.spec)}, ${esc(p.price)}, ${esc(p.subcategories)}, 1, ${esc(p.order)});`
  )
}

const sql = lines.join('\n') + '\n'
fs.writeFileSync(path.resolve(__dirname, 'seed.sql'), sql)
console.log(`Generated db/seed.sql: ${categories.length} categories, ${products.length} products`)
