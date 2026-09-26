#!/usr/bin/env node
/**
 * 双端发布一致性门禁（第九轮 R9-H2）
 *
 * 对标实测：`microfeed` 的 CI step「Verify the deployment and publish links」会真打线上
 * （带重试阶梯 + DoH 兜底"系统 DNS 还没跟上"，校验不过就 throw 让 job 变红）；
 * `minshop` 的 deploy.mjs 在 wrangler 成功后再对**线上域名**重试清跨版本缓存。
 * 但"同时核两个托管目标是否同一批发布"—— 实测 **8 个对标项目 0 家有**（它们只有一个目标）。
 * 本仓是 admin+API 在 Cloudflare Pages、顾客端在 GitHub Pages 的双前端，
 * 而这一致性此前是**人工收尾动作**（第六/七/八轮各手写一次"两端 sw.js 指纹"），
 * 且 `dispatch.yml` 是独立 workflow ⇒ CI 绿≠两端同步（坑 36 的成因）。本脚本把它变成判据。
 *
 * 判据三条（全部当场取，不信任何缓存）：
 *  1. 两端 `sw.js` 的 `CACHE_VERSION = 'sm-v<13位ms>'` 都存在且形状合法；
 *  2. 两端指纹都**不早于本次发布起点**（`PARITY_AFTER_TS`，epoch 秒）⇒ 证明两端都被这次发布刷新型；
 *     两者相差 > BATCH_SKEW_MS 视为不同批次（一端发了、另一端没发）；
 *  3. 两端入口 HTML 引用的 `/assets/index-*.js` **同名** ⇒ 同一构建；
 *     另核公开接口条数 > 0（防"发布成功但数据空"）。
 *
 * CDN 传播按坑 32 的实测给重试阶梯（GitHub Pages 边缘约 2–3 分钟）。
 *
 * 退出码：0=一致 / 1=不一致或取不到（响亮失败，不静默过） / 2=环境参数缺失
 */
const PAGES = process.env.DEPLOY_URL || 'https://supermarket-web.pages.dev'
const CUSTOMER = process.env.CUSTOMER_URL || 'https://lxh113377.github.io'
const AFTER_TS = Number(process.env.PARITY_AFTER_TS || 0)
const RETRIES = Number(process.env.PARITY_RETRIES || 6)
const DELAYS_MS = (process.env.PARITY_DELAYS || '0,20000,30000,45000,60000,90000').split(',').map(Number)
const BATCH_SKEW_MS = Number(process.env.PARITY_SKEW_MS || 6 * 3600 * 1000)

const UA = { 'user-agent': 'supermarket-web-release-parity/1.0 (CI gate)' }
const notes = []
const problems = []

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getText(url) {
  try {
    const res = await fetch(url, { headers: UA, cache: 'no-store', redirect: 'follow' })
    return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : '' }
  } catch (e) {
    return { ok: false, status: 0, body: '', err: e.message }
  }
}

/** 一次抓取解析：sw 指纹 + 入口 bundle 名 */
async function probeSite(label, base) {
  const sw = await getText(`${base.replace(/\/$/, '')}/sw.js`)
  const html = await getText(`${base.replace(/\/$/, '')}/`)
  const fp = /CACHE_VERSION\s*=\s*['"](sm-v\d{10,16})['"]/.exec(sw.body)?.[1] ?? null
  const bundle = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html.body)?.[1] ?? null
  return {
    label, base, swStatus: sw.status, htmlStatus: html.status, swErr: sw.err || '', htmlErr: html.err || '',
    fp, fpTs: fp ? Number(fp.replace(/^sm-v/, '')) : 0, bundle,
  }
}

function describe(r) {
  return `${r.label}: sw.js=http ${r.swStatus}${r.swErr ? `/${r.swErr}` : ''} 指纹=${r.fp ?? '未取到'}，`
    + `入口 http ${r.htmlStatus}${r.htmlErr ? `/${r.htmlErr}` : ''} bundle=${r.bundle ?? '未取到'}`
}

async function main() {
  if (!AFTER_TS) {
    console.error('[parity] 环境参数缺失：PARITY_AFTER_TS（本次发布起点 epoch 秒）未给 —— '
      + '没有起点就无法判"两端是否都被这次发布刷新型"，拒绝以"看起来一样"放行')
    process.exit(2)
  }
  const startTs = Date.now()
  let a = null
  let b = null
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    a = await probeSite('pages.dev', PAGES)
    b = await probeSite('github.io', CUSTOMER)
    const bothFresh = [a, b].every((r) => r.fp && r.fpTs >= AFTER_TS * 1000)
    const sameBundle = a.bundle && a.bundle === b.bundle
    if (bothFresh && sameBundle) break
    if (attempt < RETRIES) {
      const wait = DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)] || 0
      notes.push(`第 ${attempt} 次未达一致（pages ${a.fp ?? '-'} / customer ${b.fp ?? '-'}），等 ${wait}ms 后复取（CDN 传播按坑 32）`)
      await sleep(wait)
    }
  }

  for (const r of [a, b]) {
    if (!r.fp) problems.push(`${r.label} 取不到 sw.js 的 CACHE_VERSION（sw.js=http ${r.swStatus}${r.swErr ? ` ${r.swErr}` : ''}）—— 发布未生效或不可达，不静默过`)
    else if (r.fpTs < AFTER_TS * 1000) {
      problems.push(`${r.label} 指纹 ${r.fp} 早于本次发布起点 ${new Date(AFTER_TS * 1000).toISOString()}，即这一端**没被本次发布刷新**`)
    }
  }
  const skew = Math.abs(a.fpTs - b.fpTs)
  if (a.fp && b.fp && skew > BATCH_SKEW_MS) {
    problems.push(`两端指纹相差 ${(skew / 60000).toFixed(0)} 分钟 > ${BATCH_SKEW_MS / 60000} 分钟 ⇒ 不同批次发布（一端新、一端旧）`)
  }
  if (a.fp && b.fp && !a.bundle) problems.push(`pages.dev 入口 HTML 里没解析到 /assets/index-*.js（构建产物异常或首页非 SPA）`)
  else if (a.fp && b.fp && a.bundle && a.bundle !== b.bundle) {
    problems.push(`两端入口 bundle 不同名：pages.dev=${a.bundle} vs github.io=${b.bundle} ⇒ 不同构建`)
  }

  const pub = await getText(`${PAGES.replace(/\/$/, '')}/pub`)
  let count = -1
  try {
    const res = await fetch(`${PAGES.replace(/\/$/, '')}/pub`, {
      method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'getPublicProducts', payload: {} }),
    })
    const j = await res.json()
    count = Array.isArray(j?.data) ? j.data.length : -1
    if (!res.ok || j?.code !== 0 || count <= 0) problems.push(`/pub getPublicProducts 异常：http=${res.status} code=${j?.code} 条数=${count}`)
  } catch (e) {
    problems.push(`/pub 契约调用失败：${e.message}`)
  }

  for (const n of notes) console.log(`[parity] ${n}`)
  console.log(`[parity] 起点=${new Date(AFTER_TS * 1000).toISOString()} 复取耗时=${((Date.now() - startTs) / 1000).toFixed(0)}s`)
  console.log(`[parity] ${describe(a)}`)
  console.log(`[parity] ${describe(b)}`)
  console.log(`[parity] /pub 上架条数=${count}（GET /pub http=${pub.status}）`)

  if (problems.length) {
    console.error(`[parity] FAIL ${problems.length} 项：`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('  说明：两端由两条链路发布（CI deploy 部 pages.dev，dispatch.yml 驱动 github.io 的 deploy.yml），')
    console.error('  任一条红/延迟都会造成半发布（坑 36）。本判据只报事实，不改内容、不回滚（回滚仍由 smoke 触发）。')
    process.exit(1)
  }
  console.log(`[parity] OK 两端同批发布：指纹 ${a.fp} / ${b.fp}，入口 bundle 同为 ${a.bundle}，公开商品 ${count} 条`)
}

main().catch((e) => {
  console.error(`[parity] 未预期异常：${e?.stack || e}`)
  process.exit(1)
})
