// HTTP 层读数：首屏 HTML 体积、压缩、缓存语义、TTFB、Early Hints 载体。
//
// 这一层量的是「服务端到底发了什么、第一个字节何时到」——它与浏览器侧 FCP/LCP
// 是两件事：前者是**因**，后者是**果**（docs/05 两张表的关系）。
//
// 用法：node rust/scripts/measure-http.mjs --base http://127.0.0.1:5182 --label edge [--json out.json]

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const base = argOf('--base', 'http://127.0.0.1:5182')
const label = argOf('--label', 'edge')
const jsonOut = argOf('--json', '')

const fmt = (n) => (n == null ? '—' : n + ' B')

// 注意一个反直觉点：`fetch` 会**自动解压** br/gzip 体，所以 `arrayBuffer().byteLength`
// 是「解码后」的大小 —— 拿它当「传输体积」会把 brotli 的收益全部抹掉（第一版就报了
// 133702 B 这样等于原文件长度的数）。传输体积一律读 `content-length`（我们总会带上它）。
const once = async (url, headers = {}) => {
  const started = process.hrtime.bigint()
  const res = await fetch(url, { headers, redirect: 'manual' })
  const headersAt = process.hrtime.bigint()
  const body = await res.arrayBuffer()
  const done = process.hrtime.bigint()
  const headerMap = Object.fromEntries(res.headers.entries())
  const declared = Number(headerMap['content-length'])
  return {
    status: res.status,
    headers: headerMap,
    decodedBytes: body.byteLength,
    transferBytes: Number.isFinite(declared) && declared > 0 ? declared : body.byteLength,
    ttfbMs: Number(headersAt - started) / 1e6,
    totalMs: Number(done - started) / 1e6,
  }
}

/** 多次取样取中位：单次读数会被进程调度噪声污染（首请求尤其明显）。 */
const head = async (url, headers = {}, times = 5) => {
  const runs = []
  for (let i = 0; i < times; i += 1) runs.push(await once(url, headers))
  const medianOf = (key) => {
    const xs = runs.map((r) => r[key]).sort((a, b) => a - b)
    return xs[Math.floor(xs.length / 2)]
  }
  return {
    ...runs[runs.length - 1],
    ttfbMs: medianOf('ttfbMs'),
    totalMs: medianOf('totalMs'),
    transferBytes: runs[runs.length - 1].transferBytes,
    samples: runs.length,
  }
}

const results = {}
{
  const r = await head(base + '/', { 'accept-encoding': 'br, gzip' })
  results.shell = r
  console.log('[' + label + '] GET /  (' + r.status + ')')
  console.log('  TTFB          ' + r.ttfbMs.toFixed(2) + ' ms（' + r.samples + ' 次中位）')
  console.log('  HTML 传输体积 ' + fmt(r.transferBytes) + '（' + (r.headers['content-encoding'] || 'identity') +
    '；解码后 ' + fmt(r.decodedBytes) + '）')
  console.log('  Cache-Control ' + (r.headers['cache-control'] || '—'))
  console.log('  ETag          ' + (r.headers['etag'] || '—'))
  console.log('  Vary          ' + (r.headers['vary'] || '—'))
  console.log('  Link          ' + (r.headers['link'] || '—'))
  console.log('  Server        ' + (r.headers['server'] || '—'))
  console.log('  X-Edge-Shell  ' + (r.headers['x-edge-shell'] || '—'))
}
{
  // 304：带上 ETag 再请求一次，必须零字节
  const etag = results.shell.headers['etag']
  if (etag) {
    const r = await head(base + '/', { 'accept-encoding': 'br, gzip', 'if-none-match': etag })
    results.shell304 = r
    console.log('  再请求（If-None-Match）→ ' + r.status + '，body ' + fmt(r.transferBytes) + '，耗时 ' + r.ttfbMs.toFixed(2) + ' ms')
  }
}
{
  // 资产：拿 <script src> 里的入口 chunk 验长缓存与压缩
  const html = Buffer.from(await (await fetch(base + '/')).arrayBuffer()).toString('utf8')
  const asset = html.match(/assets\/[A-Za-z0-9_.-]+\.js/)
  if (asset) {
    const r = await head(base + '/' + asset[0], { 'accept-encoding': 'br, gzip' })
    results.entryChunk = { path: asset[0], ...r }
    console.log('[' + label + '] GET /' + asset[0])
    console.log('  TTFB          ' + r.ttfbMs.toFixed(2) + ' ms')
    console.log('  传输体积      ' + fmt(r.transferBytes) + '（' + (r.headers['content-encoding'] || 'identity') +
      '；解码后 ' + fmt(r.decodedBytes) + '）')
    console.log('  Cache-Control ' + (r.headers['cache-control'] || '—'))
  }
}
{
  // gzip 回退：模拟只支持 gzip 的老客户端，确认协商正确
  const r = await head(base + '/', { 'accept-encoding': 'gzip' })
  results.shellGzipOnly = { bytes: r.transferBytes, encoding: r.headers['content-encoding'] }
  // 显式拒绝 br 与 gzip：必须回 identity，不能再给压缩体
  const r2 = await head(base + '/', { 'accept-encoding': 'br;q=0, gzip;q=0' })
  results.shellIdentity = { bytes: r2.transferBytes, encoding: r2.headers['content-encoding'] || 'identity' }
  console.log('  协商：仅 gzip → ' + (results.shellGzipOnly.encoding || 'identity') + ' ' + fmt(results.shellGzipOnly.bytes) +
    '；拒绝两者 → ' + results.shellIdentity.encoding + ' ' + fmt(results.shellIdentity.bytes))
}
{
  const r = await head(base + '/_health')
  results.health = { status: r.status, body: Buffer.from(await (await fetch(base + '/_health')).arrayBuffer()).toString('utf8').slice(0, 400) }
  console.log('[' + label + '] GET /_health → ' + r.status)
  console.log('  ' + results.health.body)
}

if (jsonOut) {
  const fs = await import('node:fs')
  // 末行换行：仓内 pre-commit 的 insert_final_newline 是硬要求（见 measure-local 的同款注释）。
  fs.writeFileSync(jsonOut, JSON.stringify({ label, base, at: new Date().toISOString(), ...results }, null, 2) + '\n')
  console.log('已写 ' + jsonOut)
}
