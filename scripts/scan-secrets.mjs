#!/usr/bin/env node
/**
 * 轻量密钥扫描门禁（CI / pre-commit 共用）
 *
 * 设计原则：
 * - 只扫"会被提交的内容"——默认扫 `git ls-files`（已自动排除 .gitignore 的
 *   node_modules / dist / .env / cloudbaserc.json 等）；`--staged` 模式只扫暂存区。
 * - 模式均为高信号特征（私钥块、AWS/Tencent/Google/Slack/OpenAI 等前缀），
 *   并对"关键词=长值"做二次熵过滤，尽量降低误报。
 * - 任何命中即退出码 1，阻断提交 / 让 CI 失败；零命中退出 0。
 *
 * 用法：
 *   node scripts/scan-secrets.mjs            # 扫全仓已跟踪文件
 *   node scripts/scan-secrets.mjs --staged   # 只扫 git 暂存区（供 pre-commit 钩子）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { bail } from './lib/preflight.mjs'

const STAGED = process.argv.includes('--staged')

// 高信号密钥特征
const PATTERNS = [
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'tencent-secret-id', re: /\bAKID[A-Za-z0-9]{32}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  // 关键词 = 长值（二次过滤：长度>=24 且含数字，或长度>=40；剔除 your-secret-here 这类占位）
  {
    name: 'generic-secret-assignment',
    re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"]([A-Za-z0-9/+_@#$%^&*=!?-]{24,})['"]/i,
    validate: (m) => {
      const v = m[2]
      return v.length >= 40 || (v.length >= 24 && /\d/.test(v))
    },
  },
]

function listFiles() {
  // 第三十轮（非门禁面换分母普查抓到的第 4 个缺陷）：这里原先既不拦"git 取不到清单"，
  // 也不拦"清单为空"。实测在一个没有 .git 的目录里跑它，git 的 stderr 先漏出来当第一行，
  // 紧跟着 execFileSync 抛未捕获异常甩裸栈；而在一个**零跟踪文件**的仓库里跑它，它打印
  // 「✅ 全仓密钥扫描通过，未发现问题。」并 exit 0 —— 与真扫过 42 个文件的输出逐字相同。
  // 那正是第二十五轮 check-licenses、第二十六轮 check-schema-drift 的同一个病，只是这条入口
  // 从来不在探针分母里（非门禁类），所以藏了 29 轮。
  const args = STAGED ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files']
  let out = ''
  try {
    out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const why = e instanceof Error ? String(e.stderr || e.message).split(/\r?\n/)[0] : String(e)
    bail('scan-secrets', `git ${args[0]} 取不到文件清单（${why}）⇒ 一个文件都没看到，不能判"未发现密钥"`)
  }
  return out.split('\n').filter(Boolean)
}

function isBinary(buf) {
  // 含 NUL 字节即视为二进制，跳过
  return buf.includes(0)
}

const findings = []
let scanned = 0
for (const file of listFiles()) {
  let content
  try {
    const buf = readFileSync(file)
    scanned++                       // "读到了"才算看过；二进制是**看过且判定跳过**，不是没看到
    if (isBinary(buf)) continue
    content = buf.toString('utf8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      const m = p.re.exec(line)
      if (m && (!p.validate || p.validate(m))) {
        findings.push({ file, line: i + 1, pattern: p.name, snippet: line.trim().slice(0, 120) })
        break
      }
    }
  })
}

if (findings.length) {
  console.error(`\n🚨 密钥扫描发现 ${findings.length} 处疑似泄露，已阻断${STAGED ? '提交' : '仓库检查'}（共读过 ${scanned} 个文件）：\n`)
  for (const f of findings) {
    console.error(`  [${f.pattern}] ${f.file}:${f.line}`)
    console.error(`    ${f.snippet}`)
  }
  console.error('\n若确认是误报：先复核该特征为何命中（把结论记进 docs/），**不要用跳过钩子的开关提交**——绕过去的那一次不留任何痕迹。')
  process.exit(1)
}

// 分母为零时"通过"和"没得扫"必须长得不一样（本轮实测：零跟踪文件的仓库曾打印与干净扫描
// 逐字相同的「✅ …密钥扫描通过，未发现问题。」并 exit 0）。
if (scanned === 0) {
  if (STAGED) {
    console.log('ℹ️ 暂存区没有文件 ⇒ 无可扫对象（这是"跳过"，不是"通过"）')
    process.exit(0)
  }
  bail('scan-secrets', `git 清单里 0 个文件可读 ⇒ 一个对象都没扫到，不能判"未发现密钥"`)
}

console.log(STAGED
  ? `✅ 暂存区密钥扫描通过：已读 ${scanned} 个文件，未发现问题。`
  : `✅ 全仓密钥扫描通过：已读 ${scanned} 个文件，未发现问题。`)
process.exit(0)
