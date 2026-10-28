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
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const rowsFile = argOf('--rows', '')
const port = Number(argOf('--port', '5199'))
const token = argOf('--token', 'mock-token')
// --record <file>：把收到的每条语句按形状追加成 JSONL。
// 为什么需要它：原生管理路径要写**审计**（security_events INSERT）——本机没有真 D1，
// 唯一能证明「审计真的发生了」的判据就是「mock 收到了那条 INSERT，且参数形状对」。
// 只记形状与参数类型/长度，**不记参数原值**（审计参数含 IP 与密钥指纹，不该落到读数文件里）。
const recordFile = argOf('--record', '')
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
    if (recordFile) {
      appendFileSync(recordFile, JSON.stringify({
        sql: norm(parsed.sql).slice(0, 120),
        isWrite: /^(INSERT|UPDATE|DELETE)/i.test(parsed.sql.trim()),
        paramCount: Array.isArray(parsed.params) ? parsed.params.length : 0,
        paramTypes: Array.isArray(parsed.params) ? parsed.params.map((x) => (x === null ? 'null' : typeof x)) : [],
        paramLengths: Array.isArray(parsed.params) ? parsed.params.map((x) => (typeof x === 'string' ? x.length : null)) : [],
      }) + '\n')
    }
    // 写语句：**原样接受**并回空结果集 —— mock 不做 SQL 引擎，但不能挡写路径
    //（挡住会让审计静默丢失，而现网恰恰吞掉审计错误 ⇒ 那会变成「看着一切正常、其实没留痕」）
    if (/^(INSERT|UPDATE|DELETE)/i.test(parsed.sql.trim())) {
      res.writeHead(200, { 'content-type': 'application/json' })
      // 负控支持：当 rows.json 里 __metaMissingIds 命中本次参数时，UPDATE/DELETE 回 changes=0
      // —— 这是现网「守卫式 UPDATE 命中 0 行」路径（product_not_found）唯一可判的地方。
      // 注意变量名：rows.json 解析结果叫 table（不是 state），参数在 parsed.params。
      // 第一版写错名字 ⇒ 每次写都抛 ReferenceError ⇒ 审计静默全丢（端到端一次红 66 项）。
      const missing = Array.isArray(table.__metaMissingIds) ? table.__metaMissingIds : []
      const hitsGhost = (Array.isArray(parsed.params) ? parsed.params : []).some(
        (p) => typeof p === 'string' && missing.includes(p),
      )
      const changes = hitsGhost ? 0 : 1
      res.end(JSON.stringify({ success: true, result: [{ results: [], success: true, meta: { changes, rows_read: 0 } }] }))
      return
    }
    // 参数感知：先查「SQL|params」复合键，再回落纯 SQL 键。
    // 为什么需要：同一条 SQL 在**不同分页参数**下会回不同的行（LIMIT/OFFSET 在参数里），
    // 只用 SQL 当键的话，两个分页用例会互相覆盖、判据变成假绿/假红。
    const paramKey = sql + '|' + JSON.stringify(Array.isArray(parsed.params) ? parsed.params : [])
    const rows = normTable[paramKey] || normTable[sql]
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
if (recordFile) writeFileSync(recordFile, '') // 每轮清账：避免上一轮的语句混进本轮读数
server.listen(port, '127.0.0.1', () => console.log('mock D1 监听 http://127.0.0.1:' + port + '｜预设 SQL ' + Object.keys(normTable).length + ' 条' + (recordFile ? '｜记录 ' + recordFile : '')))
