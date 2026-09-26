#!/usr/bin/env node
/**
 * 「PR 是否带回归手段」报告型判据（第十轮 R10-M2）
 *
 * 对标取证：`cloudflare/workers-sdk` 的 `tools/deployments/validate-pr-description.ts:54`
 * 把"PR 必须含测试"做成硬门禁（逃生门是 `ci:no-tests` 标签）。本仓规矩同源但**先不接线**：
 * 本项目绝大多数改动走直推 main（PR 只有 dependabot），硬门禁第一天就会把 dependabot
 * 六条全判红 ⇒ 按「新指标先量误报率再决定阻断」（既有立规）本轮做成报告型：
 * 只打印、永远 exit 0，跑一段看它报的都是不是该报的，再谈接线。
 *
 * 取 PR 列表为什么绕这一圈：GH_TOKEN 明文规则下 workflow 必须 `permissions: contents: read`，
 * 该 token 调 `GET /pulls` 实测 403 ⇒ 改用 `gh pr list`（GH_TOKEN 自带 gh 作用域），
 * 拿不到就跳过，绝不静默判红（跳过会打出一行 SKIPPED 供人核）。
 */
import { execFileSync } from 'node:child_process'

const CODE_DIRS = ['src/', 'functions/']
const TEST_HINTS = ['tests/', 'test/', '.test.', '.spec.']

export function isTestFile(f) {
  return TEST_HINTS.some((h) => f.includes(h))
}

/** 纯判定：改了产品代码却没碰任何测试 ⇒ 列进"该补回归手段"名单。 */
export function evaluatePrTests(changedFiles) {
  const code = changedFiles.filter((f) => CODE_DIRS.some((d) => f.startsWith(d)))
  const tests = changedFiles.filter(isTestFile)
  if (!code.length) return { verdict: 'no-code-change', code: [], tests: [] }
  if (tests.length) return { verdict: 'covered', code, tests }
  return { verdict: 'missing-tests', code, tests }
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
}

function main() {
  let out = ''
  try {
    out = run('gh', ['pr', 'list', '--json', 'number,headRefName,headRefOid,baseRefName'])
  } catch (e) {
    console.log(`[pr-advisory] SKIPPED 取不到 PR 列表（gh 不可用）：${e instanceof Error ? e.message.split('\n')[0] : e}`)
    return
  }
  let prs = []
  try {
    prs = JSON.parse(out || '[]')
  } catch {
    console.log('[pr-advisory] SKIPPED gh 输出不是合法 JSON，跳过而不是判红')
    return
  }
  if (!prs.length) {
    console.log('[pr-advisory] 当前没有开放 PR ⇒ 无可判对象（这不是通过，是空集）')
    return
  }
  let flagged = 0
  for (const pr of prs) {
    let files = []
    try {
      const range = `${pr.baseRefName}..${pr.headRefOid}`
      files = run('git', ['diff', '--name-only', range]).split('\n').filter(Boolean)
    } catch (e) {
      console.log(`  - PR #${pr.number}: 取 diff 失败（${e instanceof Error ? e.message.split('\n')[0] : e}），跳过`)
      continue
    }
    const v = evaluatePrTests(files)
    const mark = { 'no-code-change': '纯文档/配置', covered: '带回归', 'missing-tests': '⚠ 缺回归手段' }[v.verdict]
    console.log(`  - PR #${pr.number} (${pr.headRefName}): ${mark} — 代码 ${v.code.length} 文件 / 测试 ${v.tests.length} 文件`)
    if (v.verdict === 'missing-tests') flagged++
  }
  console.log(`[pr-advisory] 报告完成：${prs.length} 个开放 PR，其中 ${flagged} 个缺测试面（本判据不阻断）`)
}

if (process.argv[1] && /check-pr-has-tests\.(mjs|js)$/.test(process.argv[1])) main()
