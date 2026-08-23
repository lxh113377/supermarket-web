#!/usr/bin/env node
// 部署冒烟脚本（零依赖，Node 原生 fetch）
// 四项检查：
//   1. 静态站根路径 HTTP 200 且含 id="root"
//   2. /web getOrders（需 ADMIN_KEY）code 0
//   3. /web getProducts（需 ADMIN_KEY）code 0
//   4. /pub getPublicProducts code 0
// 任一失败 exit 1；脚本不输出密钥本身。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const DEFAULTS = {
  staticBase: 'https://supermarket-web.pages.dev',
  apiBase: 'https://supermarket-web.pages.dev/web',
  pubBase: 'https://supermarket-web.pages.dev/pub',
}

function readDotEnv(key) {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return ''
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && m[1] === key) {
      return m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return ''
}

function pickBase(envKey, dotEnvKey, fallback) {
  const fromEnv = process.env[envKey]
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  const fromDotEnv = readDotEnv(dotEnvKey)
  if (fromDotEnv) return fromDotEnv.replace(/\/+$/, '')
  return fallback
}

function readAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY
  const cfgPath = path.join(ROOT, 'cloudbaserc.json')
  if (!fs.existsSync(cfgPath)) return ''
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    const env = (cfg.functions || []).find((f) => f.name === 'admin-api')?.envVariables || {}
    const key = env.aDMIN_KEY || env.ADMIN_KEY || ''
    // 占位符不算真实密钥（部署前为 ${ADMIN_KEY}）
    if (key && key !== '${ADMIN_KEY}') return key
  } catch {
    // cloudbaserc.json 解析失败按缺失处理
  }
  return ''
}

async function httpJson(url, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    try {
      return { ok: true, json: JSON.parse(text) }
    } catch {
      return { ok: false, error: `响应不是 JSON：${text.slice(0, 120)}` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function checkStatic(base) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`${base}/`, { signal: controller.signal })
    if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` }
    const html = await res.text()
    if (!html.includes('id="root"')) return { ok: false, error: '页面缺少 id="root" 挂载点' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function report(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const staticBase = pickBase('STATIC_BASE', 'VITE_CB_STATIC_BASE', DEFAULTS.staticBase)
const apiBase = pickBase('API_BASE', 'VITE_CB_API_BASE', DEFAULTS.apiBase)
const pubBase = pickBase('PUBLIC_API_BASE', 'VITE_CB_PUBLIC_API_BASE', DEFAULTS.pubBase)
const adminKey = readAdminKey()

let allPass = true

// 1. 静态站
const staticRes = await checkStatic(staticBase)
if (!staticRes.ok) allPass = false
report(`静态站 ${staticBase}/`, staticRes.ok, staticRes.error || '')

// 2-3. /web 管理端点（需要密钥）
if (!adminKey) {
  allPass = false
  report('/web getOrders', false, '缺少 ADMIN_KEY（设置环境变量或在 cloudbaserc.json 注入非占位符密钥）')
  report('/web getProducts', false, '缺少 ADMIN_KEY')
} else {
  for (const action of ['getOrders', 'getProducts']) {
    const res = await httpJson(apiBase, { action, adminKey, payload: {} })
    const pass = res.ok && res.json?.code === 0
    if (!pass) allPass = false
    report(`/web ${action}`, pass, res.ok ? `code=${res.json?.code} message=${res.json?.message || ''}` : res.error)
  }
}

// 4. /pub 公开端点
const pubRes = await httpJson(pubBase, { action: 'getPublicProducts', payload: {} })
const pubPass = pubRes.ok && pubRes.json?.code === 0
if (!pubPass) allPass = false
report('/pub getPublicProducts', pubPass, pubRes.ok ? `code=${pubRes.json?.code} message=${pubRes.json?.message || ''}` : pubRes.error)

console.log(allPass ? 'SMOKE PASS：四项全部通过' : 'SMOKE FAIL：存在失败项')
process.exit(allPass ? 0 : 1)
