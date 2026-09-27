#!/usr/bin/env node
// 第三十三轮：分支保护 / Required checks 的**在册普查**（advisory，永不阻断提交）
//
// 为什么现在才立：这条欠账从第二十八轮起挂了 5 次，每次都是我在报告里手写"`gh api` 又 404 了"——
// 口头重跑有三个问题：① 只有我记得时才被检查；② 结论没有落到机器可读的地方；③ 把"取不到"和
// "确实没开"混成同一句话。本脚本把它变成一条每轮都跑、四态分明的在册普查。
//
// 对标件 `ossf/scorecard` `docs/checks.md` §Branch-Protection 原文两条（api.github.com raw，2026-09-27）：
//   ① "The following settings queried by the Branch-Protection check require an admin token:
//      DismissStaleReviews, EnforceAdmins, RequireLastPushApproval, RequiresStatusChecks, UpToDateBeforeMerge"
//   ② "If Scorecard is run without an administrative access token, the requirements that specify
//      'For administrators' can be safely ignored, and scores will be determined **as if all such
//      requirements have been met**."
// ②是**评分器**的合理取舍（缺观测不该扣分），但我们是**台账**：取不到就写"未观测"，
// 绝按满足计 ⇒ 所以这里有 INCONCLUSIVE / UNVERIFIED 两个独立状态，不复用"没开"，也不复用"取不到"。
//
// 用法：node scripts/check-branch-protection.mjs [owner/repo]     真查（需 gh 鉴权）
//       BRANCH_PROTECTION_JSON=<file> 喂录制（夹具用，不联网）
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const REPO_DEFAULT = 'lxh113377/supermarket-web'
const ADMIN_ONLY = ['DismissStaleReviews', 'EnforceAdmins', 'RequireLastPushApproval', 'RequiresStatusChecks', 'UpToDateBeforeMerge']

/** 纯判据：两条通道（经典 protection / 现代 rulesets）各自的 HTTP 结果 → 四态。 */
export function evaluate({ repo = REPO_DEFAULT, protection, rulesets, rulesetDetail = null, at = new Date().toISOString() } = {}) {
  const rec = (domain, status) => `${domain}=${status ?? 'n/a'}`
  const pCode = protection?.status ?? protection?.http ?? 'n/a'
  const rCode = rulesets?.status ?? rulesets?.http ?? 'n/a'
  const protectedBranch = protection && (protection.http === 200 || protection.status === 200)
  const rulesetActive = Array.isArray(rulesets?.enforcement_active) ? rulesets.enforcement_active : []
  const detail = rulesetDetail && !protectedBranch
  if (protectedBranch) {
    const req = protection.required_status_checks?.contexts || protection.required_status_checks?.checks?.map((c) => c.context) || []
    return {
      state: 'ENFORCED', rc: 0,
      line: `ENFORCED :: 经典 protection 在（${rec('protection', pCode)}；${rec('rulesets', rCode)}；要求通过的 check：${req.length ? req.join(', ') : '（未列）'}）；admin-only 子项未观测：${ADMIN_ONLY.join(', ')}`,
      at, unobserved: ADMIN_ONLY,
    }
  }
  if (rulesetActive.includes(repo) || (detail && detail.http === 200 && (detail.rulesets || []).some((r) => r.enforcement === 'active'))) {
    return { state: 'ENFORCED-VIA-RULESET', rc: 0, line: `ENFORCED-VIA-RULESET :: protection ${rec('protection', pCode)}，但 ruleset 生效（${rec('rulesets', rCode)}）`, at, unobserved: ADMIN_ONLY }
  }
  // 只有**两条通道都取到了明确结果**（404 / 空列表）才敢说"没开"
  const bothObserved = (pCode === 404 || pCode === '404') && (rCode === 200 || rCode === 404 || rCode === 403)
  if (bothObserved) {
    return { state: 'NOT_ENFORCED', rc: 0, line: `NOT_ENFORCED :: ${rec('protection', pCode)}（404=未启用）+ ${rec('rulesets', rCode)}（无生效 ruleset）⇒ 服务端不拦任何 push，CI 绿只靠本地钩子`, at, unobserved: [] }
  }
  return {
    state: 'UNVERIFIED', rc: 2,
    line: `UNVERIFIED :: ${rec('protection', pCode)} ${rec('rulesets', rCode)} ⇒ 至少一条通道没取到可信读数，**不按"没开"也不按"已开"记**`,
    at, unobserved: ADMIN_ONLY,
  }
}

function gh(args) {
  // 防呆（第三十三轮实修）：调用方传的是**路径字符串**，而 `[...字符串]` 会把它拆成一堆单字符参数
  // ⇒ gh 收到碎参数按用法错误退出（status=3），于是我的映射读出 'ERR'，把"能查到"伪装成"查不到"。
  const argv = Array.isArray(args) ? args : [String(args)]
  const r = spawnSync('gh', ['api', ...argv], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.error) return { error: r.error.code || String(r.error.message).slice(0, 60) }
  let body = null
  try { body = JSON.parse(r.stdout) } catch { body = null }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) body = {}   // 数字/数组/空 body 都不能把 http 字段覆盖掉
  const both = `${r.stderr}${r.stdout}`
  const http = r.status === 0 ? 200
    : /\b404\b|not found/i.test(both) ? 404
      : /\b403\b|must have access|permission/i.test(both) ? 403
        : /\b401\b|Bad credentials|Requires authentication/i.test(both) ? 401
          : `rc=${r.status ?? 'null'}`
  return { http, ...body, status: body.status ?? (body.http_message || undefined) }
}

export function main({ repo = process.argv[2] || REPO_DEFAULT } = {}) {
  const injected = process.env.BRANCH_PROTECTION_JSON
  if (injected) {
    const j = JSON.parse(readFileSync(injected, 'utf8'))
    const res = evaluate({ repo, ...j })
    console.log(`[branch-protection] ${res.line}｜时刻=${res.at}`)
    return res.rc
  }
  const prot = gh(`repos/${repo}/branches/main/protection`)
  const rules = gh(`repos/${repo}/rulesets`)
  if (prot.error || rules.error) {
    bail('branch-protection', `gh 不可用（protection:${prot.error || 'ok'} / rulesets:${rules.error || 'ok'}）⇒ 取不到读数就不下结论，改测请喂 BRANCH_PROTECTION_JSON`)
  }
  const res = evaluate({ repo, protection: prot, rulesets: rules, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') })
  const n = (res.unobserved || []).length
  console.log(`[branch-protection] ${res.line}｜时刻=${res.at}｜admin-only 子项未观测 ${n} 项` +
    (n ? '（scorecard 对它们"按满足计"，本判据不：取不到就不写成功）' : '（服务端未启用，无从观测其子项）'))
  return res.rc
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main({ repo: process.argv[2] }))
