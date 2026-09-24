#!/usr/bin/env node
/**
 * 从 docs/api-contract.json 生成人读版 docs/API.md（对标 Saleor 的 SDL 自描述 / litemall 的 doc/api.md）
 *
 * 契约的机器真相源是 api-contract.mjs 生成的 JSON（漂移即 verify:contract 红）；
 * 但 JSON 不适合人读，手写 Markdown 又会和 JSON 各说各话。因此本文**只由 JSON 渲染**：
 * 改了 action 就重跑 `npm run docs:api`，人读的表永远是最新的。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(readFileSync(join(root, 'docs', 'api-contract.json'), 'utf8'))

const NOTE = {
  createOrder: '幂等：带 `requestId` 走 `房间号@requestId#载荷指纹` 唯一索引；不带则 90s 内容指纹兜底。命中返回 `deduplicated: true` 且不动库存',
  updateOrderStatus: '5 态状态机 + 乐观锁（UPDATE 带 `AND status = 读到的旧值`），并发迁移只有一个胜出',
  stalePendingReport: '只读盘点超时 pending 单（线下确认制，不自动砍单）',
  getOrderStatus: '顾客侧进度查询，免密钥，只回 status/updatedAt',
}

const rows = (actions) => Object.entries(actions)
  .map(([name, meta]) => `| \`${name}\` | ${meta.write ? '写' : '读'} | ${NOTE[name] ?? ''} |`)
  .join('\n')

const md = `# API 契约（人读版，由脚本生成）

> ⚠️ 本文件由 \`npm run docs:api\` 从 \`docs/api-contract.json\` 渲染，**不要手改**。
> 机器真相源：\`scripts/api-contract.mjs\`（源码解析生成）；漂移检查：\`npm run verify:contract\`（CI 阻断）。
> 生成时间：${new Date().toISOString().slice(0, 10)} ｜ 契约版本：${contract.version ?? 'n/a'} ｜ 源：${contract.source ?? 'n/a'}

## 端点与策略

${Object.entries(contract.policies ?? {}).map(([k, v]) => `- **${k}**：${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}

## \`/web\` — 管理端（${Object.keys(contract.endpoints['/web'].actions).length} 个 action）

鉴权：${contract.endpoints['/web'].auth}

| action | 读写 | 说明 |
|---|---|---|
${rows(contract.endpoints['/web'].actions)}

## \`/pub\` — 公开端（${Object.keys(contract.endpoints['/pub'].actions).length} 个 action）

鉴权：${contract.endpoints['/pub'].auth}

| action | 读写 | 说明 |
|---|---|---|
${rows(contract.endpoints['/pub'].actions)}

## 调用形态

两个端点同为 \`POST\`，请求体 \`{ action, payload, adminKey? }\`（\`/web\` 需 \`adminKey\`），
响应统一 \`{ code, data?, message? }\`，\`code: 0\` 为成功。金额一律服务端按库内价格重算，
客户端提交的金额不参与计算（防篡改）。

## 相关文档

- 架构与不变式：\`docs/ARCHITECTURE.md\`
- 决策记录（为什么这样设计）：\`docs/adr/\`
- 数据库迁移与账目：\`db/\` + \`npm run migrate status\`
`

writeFileSync(join(root, 'docs', 'API.md'), md, 'utf8')
const n = Object.keys(contract.endpoints['/web'].actions).length + Object.keys(contract.endpoints['/pub'].actions).length
console.log(`已生成 docs/API.md：${n} 个 action（/web + /pub）`)
