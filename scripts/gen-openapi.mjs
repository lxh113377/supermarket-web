#!/usr/bin/env node
/**
 * OpenAPI 派生（对标 M2）：从 docs/api-contract.json 生成 docs/openapi.json（OpenAPI 3.0 片段）。
 * 单入口 POST /web + POST /pub + GET /_health；action 走 body 区分，此处按每个 action 生成一个 operation 占位，
 * 供外部工具导入与第三方对接阅读。机器真相源仍是 api-contract.json，本文件为派生只读物。
 * 用法：node scripts/gen-openapi.mjs --write（默认 --check 对账）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail, requireInputs } from './lib/preflight.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN = path.join(root, 'docs', 'api-contract.json')
const OUT = path.join(root, 'docs', 'openapi.json')
const write = process.argv.includes('--write')

// fail-closed（第二十五轮口径）：缺输入面/零分母输入走 rc=2 人话诊断，不许甩裸栈，更不许印 OK
requireInputs('gen-openapi', [IN])
let j
try {
  j = JSON.parse(await readFile(IN, 'utf8'))
} catch {
  bail('gen-openapi', `读不懂 ${IN}（空文件或坏 JSON），无法派生`)
}
if (!j || typeof j !== 'object' || !j.endpoints || !Object.keys(j.endpoints).length) {
  bail('gen-openapi', `${IN} 里没有 endpoints（零分母输入无法派生，判"环境不满足"而非"通过"）`)
}

function actionOp(endpoint, action, meta) {
  return {
    post: {
      operationId: `${endpoint === '/web' ? 'admin' : 'public'}_${action}`,
      summary: `${endpoint} action=${action}`,
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['action'],
              properties: {
                action: { type: 'string', enum: [action] },
                adminKey: { type: 'string', description: endpoint === '/web' ? '管理密钥（/pub 不需要）' : '不需要' },
                payload: { type: 'object' }
              }
            }
          }
        }
      },
      responses: {
        // trace 写在描述里而不是 schema 里：它是**条件键**（仅边缘节点给了 cf-ray/x-request-id 且清洗后非空才出现），
        // 而本仓的响应形状契约由 wrapHandle 在 handle 层录制，结构性看不见端点层追加的这个键（钉它的腿是
        // tests/traceEnvelope.test.js）。在这里补一句是为了让 43 份 operation 不再漏说一个会出现在线上的键。
        200: { description: '{code,message,data} 纵深防御包；失败带 errorCode+kind（见 docs/error-codes.md）；有边缘 trace 时纯追加 trace 键（清洗后 ≤64 字，见 docs/logging.md）' }
      },
      'x-write': Boolean(meta.write),
      ...(meta.cacheKey ? { 'x-cache-key': meta.cacheKey } : {}),
      ...(meta.rateBucket ? { 'x-rate-bucket': meta.rateBucket } : {})
    }
  }
}

const paths = {}
for (const ep of Object.keys(j.endpoints || {})) {
  const actions = j.endpoints[ep].actions || {}
  for (const [name, meta] of Object.entries(actions)) {
    const key = `${ep}::${name}`
    paths[key] = actionOp(ep, name, meta)
  }
}
const doc = {
  openapi: '3.0.3',
  info: { title: 'supermarket-web action API', version: String(j.version ?? 1) },
  paths,
  components: {}
}
const text = JSON.stringify(doc, null, 2) + '\n'
if (write) {
  await writeFile(OUT, text)
  console.log(`wrote ${OUT} paths=${Object.keys(paths).length}`)
} else {
  let cur = ''
  try { cur = await readFile(OUT, 'utf8') } catch { cur = '' }
  if (cur !== text) {
    console.error(`漂移：docs/openapi.json 与 api-contract.json 不一致（paths=${Object.keys(paths).length}），跑 node scripts/gen-openapi.mjs --write`)
    process.exit(1)
  }
  console.log(`OK openapi paths=${Object.keys(paths).length}`)
}
