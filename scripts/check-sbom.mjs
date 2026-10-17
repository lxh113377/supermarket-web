#!/usr/bin/env node
/**
 * 供应链物料清单（SBOM）可复现登记判据（第七十五轮 I-75-4）
 *
 * 为什么是这件：对标面的十仓里，`saleor`/`medusa` 这类规模项目都把 SBOM 或依赖清单当交付物
 * （OpenSSF Scorecard 的 `SBOM` 检查项、以及 `sigstore` 生态的 attestation 都把「你发布的这坨东西
 * 由哪些包组成」当成可核对的证据）。本仓此前只有 `docs/dependency-audit.md`（**漏洞**视角）
 * 与 `verify:licenses`（**许可证**视角），**没有一份「由哪些组件组成」的清单** ——
 * 三者答的是三个不同问题：能不能用（license）、安不安全（audit）、是什么（SBOM）。
 *
 * 取数面：`npm sbom --sbom-format cyclonedx`（npm 内置，零新增依赖）。
 * 判据只做三件事，每件都对应一类真实的假账：
 *   ① **在场**：docs/sbom.cdx.json 必须存在且是 CycloneDX（没有就 UNVERIFIED，绝不折算成"干净"）
 *   ② **可复现**：当场重新生成一份到临时文件，与在册件做 **bom-ref 集合** 比对；
 *      不一致 ⇒ 有人改了依赖却没更新 SBOM（这一腿是判据的核心，不做它就只是又一份手抄文档）
 *   ③ **新鲜度**：在册件的 metadata.timestamp 龄期 ≤ 名册声明的 maxAgeDays，
 *      否则"清单在，但说的是三个月前的依赖"——与 cron 册的 C7 同一口径：过期的是证据。
 *
 * 用法：
 *   node scripts/check-sbom.mjs            真面无缓存校验（要 node + npm，故不进 CI 阻断链）
 *   node scripts/check-sbom.mjs --write    重新生成在册件（唯一写入口）
 *   node scripts/check-sbom.mjs --file F --expected E   合成面对账（夹具用，不调 npm）
 *   node scripts/check-sbom.mjs --selftest
 * 退出码：0=通过 / 1=不符（缺 / 漂 / 过期） / 2=取数面不可用（没有 npm 或生成失败）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-sbom.mjs')
export const DEFAULT_FILE = join(ROOT, 'docs', 'sbom.cdx.json')
export const MAX_AGE_DAYS = 30

/** 从 CycloneDX 里取"组件身份集合"。用 purl（包名+版本）而不是 bom-ref：
 *  bom-ref 的格式在 npm 各版本间变过（`pkg:npm/x@1` 与 `x@1` 都出现过），拿它当身份会
 *  把"npm 升级"误报成"依赖变了"。purl 是 CycloneDX 规范里的稳定外部标识。 */
export function componentKeys(j) {
  if (!j || !Array.isArray(j.components)) return null
  const keys = new Set()
  for (const c of j.components) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.purl === 'string' && c.purl.trim()) { keys.add(c.purl.trim()); continue }
    // 没有 purl 的组件（npm sbom 对 workspace/根包会这样）⇒ 退到 name@version，仍比 bom-ref 稳
    keys.add(String(c.name || '?') + '@' + String(c.version || '?'))
  }
  return [...keys].sort()
}

/** 两份清单的身份差集（双向，两个方向都是缺陷：少了=漏登，多了=旧账没清）。 */
export function diffKeys(expected, actual) {
  const a = new Set(expected || [])
  const b = new Set(actual || [])
  return {
    onlyInFile: [...a].filter((k) => !b.has(k)).sort(),
    onlyInFresh: [...b].filter((k) => !a.has(k)).sort(),
    same: [...a].filter((k) => b.has(k)).length,
  };
}

export function ageDaysOf(iso, nowIso) {
  const t = Date.parse(iso || '');
  const n = Date.parse(nowIso || '');
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.floor((n - t) / 86_400_000);
}

/** 纯判据：给定在册件、当次新鲜件、时刻与龄期上限，出三态。 */
export function evaluate({ file, fresh, nowIso, maxAgeDays = MAX_AGE_DAYS }) {
  const problems = []
  if (!file) { problems.push('在册件缺失 ⇒ 没有 SBOM 可对账（这不是"没有依赖"）'); return { rc: 1, problems, check: null } }
  if (file.bomFormat !== 'CycloneDX') { problems.push('在册件不是 CycloneDX（bomFormat=' + String(file.bomFormat) + '）⇒ 换格式必须同笔改本判据与名册'); return { rc: 1, problems, check: null } }
  const fileKeys = componentKeys(file)
  if (!fileKeys || fileKeys.length === 0) { problems.push('在册件 components 为空 ⇒ 空集 ≠ 无依赖（同 check-licenses 第二十五轮那条假绿）'); return { rc: 1, problems, check: null } }
  const check = { components: fileKeys.length, onlyInFile: [], onlyInFresh: [], same: 0, ageDays: null }
  if (fresh) {
    const freshKeys = componentKeys(fresh)
    if (!freshKeys || !freshKeys.length) { problems.push('当次新鲜件 components 为空 ⇒ 取数面坏了，不据此下结论'); return { rc: 2, problems, check } }
    const d = diffKeys(fileKeys, freshKeys)
    check.onlyInFile = d.onlyInFile;
    check.onlyInFresh = d.onlyInFresh;
    check.same = d.same;
    if (d.onlyInFresh.length) {
      problems.push('当次依赖面比在册件多 ' + d.onlyInFresh.length + ' 项（' + d.onlyInFresh.slice(0, 5).join(' , ') + (d.onlyInFresh.length > 5 ? ' …' : '') + '）⇒ 有人改了依赖却没跑 `npm run gen:sbom`');
    }
    if (d.onlyInFile.length) {
      problems.push('在册件比当次多 ' + d.onlyInFile.length + ' 项（' + d.onlyInFile.slice(0, 5).join(' , ') + (d.onlyInFile.length > 5 ? ' …' : '') + '）⇒ 清单没跟上删除，旧账没清');
    }
  } else {
    problems.push('取不到当次依赖面 ⇒ 只能判"文件在不在"，判不了"对不对"（本件退化为半把尺，rc=2）');
  }
  const ageDays = ageDaysOf(file.metadata && file.metadata.timestamp, nowIso)
  check.ageDays = ageDays
  if (ageDays === null) {
    problems.push('在册件没有可解析的 metadata.timestamp ⇒ 无法判新鲜度（不折算成"刚生成过"）');
  } else if (ageDays > maxAgeDays) {
    problems.push('在册件已 ' + ageDays + ' 天 > 上限 ' + maxAgeDays + ' 天 ⇒ 清单说的是旧依赖面，重跑 `npm run gen:sbom`');
  }
  return { rc: problems.length ? 1 : 0, problems, check }
}

function generate() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(npmCmd, ['sbom', '--sbom-format', 'cyclonedx'], { cwd: ROOT, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  if (r.error || r.status !== 0) return { error: r.error ? r.error.code || r.error.message : 'npm rc=' + r.status + ' ' + String(r.stderr || '').split('\n')[0] }
  let j = null
  try { j = JSON.parse(r.stdout) } catch (e) { return { error: 'npm sbom 输出不是 JSON（' + e.message.split('\n')[0] + '）' } }
  if (!j || j.bomFormat !== 'CycloneDX') return { error: 'npm sbom 输出的 bomFormat=' + String(j && j.bomFormat) + ' ⇒ 形态与名册不符' }
  return { json: j }
}

function selftest() {
  const mk = (keys, ts = '2026-10-17T00:00:00Z') => ({ bomFormat: 'CycloneDX', metadata: { timestamp: ts }, components: keys.map((k) => ({ name: k.split('@')[0], version: k.split('@')[1] || '0', purl: k })) })
  const A = mk(['pkg:npm/react@19.0.0', 'pkg:npm/vite@8.0.0']);
  const cases = [
    ['① 正例：在册件与当次逐项一致、龄期 0 天 ⇒ rc=0', { file: A, fresh: A, nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 0 && r.check.components === 2]
    ,['② 反例：当次多了 react-dom ⇒ 判红并点名（改依赖没更新清单）', { file: A, fresh: mk(['pkg:npm/react@19.0.0', 'pkg:npm/vite@8.0.0', 'pkg:npm/react-dom@19.0.0']), nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('react-dom'))]
    ,['③ 反例：当次少了 vite ⇒ 判红并点名（清单没跟上删除，旧账没清）', { file: A, fresh: mk(['pkg:npm/react@19.0.0']), nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('vite'))]
    ,['④ 反例：在册件龄期超上限 ⇒ 判红并具名天数（过期的是证据）', { file: A, fresh: A, nowIso: '2026-12-31T00:00:00Z', maxAgeDays: 30 }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('天 > 上限 30 天'))]
    ,['⑤ 反例：bomFormat 不是 CycloneDX ⇒ 判红（换格式必须同笔改本判据）', { file: { bomFormat: 'SPDX', metadata: { timestamp: '2026-10-17T00:00:00Z' }, components: [] }, fresh: null, nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('CycloneDX'))]
    ,['⑥ 反例：components 为空 ⇒ 判红（空集 ≠ 无依赖）', { file: { bomFormat: 'CycloneDX', metadata: { timestamp: '2026-10-17T00:00:00Z' }, components: [] }, fresh: null, nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('空集'))]
    ,['⑦ 反例：在册件缺失 ⇒ 判红而不是"干净"', { file: null, fresh: A, nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('没有 SBOM'))]
    ,['⑧ 反向腿：当次取不到 ⇒ rc=2（退化为半把尺，绝不判绿）', { file: A, fresh: null, nowIso: '2026-10-17T12:00:00Z' }, (r) => r.rc === 1 && r.problems.some((p) => p.includes('退化为半把尺'))]
  ]
  let bad = 0
  for (const [name, input, check] of cases) {
    let ok = false, note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = '（崩：' + e.message + '）' }
    if (!ok) bad += 1
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + note)
  }
  console.log('[sbom] 自证 ' + (cases.length - bad) + '/' + cases.length + (bad ? ' ⇒ 有腿没咬住' : ''))
  return bad ? 1 : 0
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : d }
  const file = arg('--file', DEFAULT_FILE)
  if (argv.includes('--write')) {
    const g = generate()
    if (g.error) { console.log('[sbom] BLOCKED ' + g.error + ' ⇒ 生成失败就不写盘（不拿半份清单冒充当次）'); return 2 }
    writeFileSync(file, JSON.stringify(g.json, null, 2) + '\n', 'utf8')
    console.log('[sbom] WROTE ' + file + '｜components=' + componentKeys(g.json).length + '｜timestamp=' + String(g.json.metadata && g.json.metadata.timestamp));
    return 0
  }
  let registered = null
  if (existsSync(file)) {
    try { registered = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.log('[sbom] BLOCKED 在册件不是合法 JSON：' + e.message.split('\n')[0]); return 2 }
  }
  const injected = arg('--expected', null)
  let fresh = null
  if (injected) {
    try { fresh = JSON.parse(readFileSync(injected, 'utf8')) } catch (e) { console.log('[sbom] BLOCKED --expected 不是合法 JSON：' + e.message.split('\n')[0]); return 2 }
  } else {
    const g = generate()
    if (g.error) {
      // 取数面不可用 = rc=2，不许降级成"只判文件在"（那等于把半把尺当整把）
      console.log('[sbom] BLOCKED 取不到当次依赖面：' + g.error + ' ⇒ rc=2，不拿"文件在"冒充"清单对"');
      return 2
    }
    fresh = g.json
  }
  const r = evaluate({ file: registered, fresh, nowIso: new Date().toISOString() })
  const tag = r.rc === 0 ? 'GATE-PASS' : (r.rc === 2 ? 'GATE-UNVERIFIED' : 'GATE-FAIL')
  console.log('[sbom] ' + tag + ' :: 在册 ' + (r.check && r.check.components) + ' 项｜同一项 ' + (r.check ? r.check.same : 0) + '｜只在当次 ' + (r.check ? r.check.onlyInFresh.length : '-') + '｜只在册 ' + (r.check ? r.check.onlyInFile.length : '-') + '｜龄期 ' + (r.check && r.check.ageDays != null ? r.check.ageDays + 'd' : '?') + '｜上限 ' + MAX_AGE_DAYS + 'd')
  for (const p of r.problems) console.log('  · ' + p)
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
