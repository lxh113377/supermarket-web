// mock D1：本地回放「D1 HTTP API」的响应形状，用来把原生链路端到端跑通。
//
// 为什么需要它：本机没有 D1 的 account/db/api token ⇒ 真值级对账做不了。
// 但链路上真正容易错的是**除 SQL 执行之外**的一切：SQL 组装、HTTP 往返、result[0].results 抽取、
// 行→JSON 映射、封套、CORS、微缓存。这些都能用 mock 逐段验真：
//   · 请求必须是 POST + Bearer；body 必须是 {sql, params}；
//   · 只对**预期的那条 SQL** 回预设的行（归一化空白后比对）；不是预期 SQL 就回 400 并说明，
//     这样「Rust 侧偷偷换了 SQL」会当场暴露，而不是靠人读代码；
//   · 行的来源是**现网响应反推**（见 check-api-native-e2e.mjs），所以最后能拿现网响应逐字段比。
//
// 用法：node rust/scripts/mock-d1-server.mjs --rows <rows.json> --port 5199

import http from 'node:http'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const rowsFile = argOf('--rows', '')
const port = Number(argOf('--port', '5199'))
const token = argOf('--token', 'mock-token')
if (!rowsFile) { console.error('需要 --rows <json>'); process.exit(2) }

// rows.json 形状：{ "<归一化后的 SQL>": [ {列:值}, … ], … }
const table = JSON.parse(readFileSync(rowsFile, 'utf8'))
const norm = (s) => String(s).split(/\s+/).join(' ').trim()
const normTable = Object.fromEntries(Object.entries(table).map(([sql, rows]) => [norm(sql), rows]))

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(JSON.stringify({ success: false, errors: [{ message: 'mock: 只接受 POST' }] })); return }
  const auth = req.headers.authorization || ''
  if (auth !== 'Bearer ' + token) { res.writeHead(401).end(JSON.stringify({ success: false, errors: [{ message: 'mock: token 不符' }] })); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let parsed
    try { parsed = JSON.parse(body) } catch { res.writeHead(400).end(JSON.stringify({ success: false, errors: [{ message: 'mock: body 不是 JSON' }] })); return }
    const sql = norm(parsed.sql)
    const rows = normTable[sql]
    if (!rows) {
      // 不认识的 SQL **不回空表**：空表会被读成「库里没有行」，那是假绿
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: false, errors: [{ code: 7500, message: 'mock: 未预期的 SQL（Rust 侧换了语句？）：' + sql.slice(0, 80) }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ success: true, result: [{ results: rows, success: true, meta: { changes: 0, rows_read: rows.length } }] }))
  })
})
server.listen(port, '127.0.0.1', () => console.log('mock D1 监听 http://127.0.0.1:' + port + '｜预设 SQL ' + Object.keys(normTable).length + ' 条'))
