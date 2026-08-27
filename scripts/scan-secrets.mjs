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
  if (STAGED) {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
  }
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
}

function isBinary(buf) {
  // 含 NUL 字节即视为二进制，跳过
  return buf.includes(0)
}

const findings = []
for (const file of listFiles()) {
  let content
  try {
    const buf = readFileSync(file)
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
  console.error(`\n🚨 密钥扫描发现 ${findings.length} 处疑似泄露，已阻断${STAGED ? '提交' : '仓库检查'}：\n`)
  for (const f of findings) {
    console.error(`  [${f.pattern}] ${f.file}:${f.line}`)
    console.error(`    ${f.snippet}`)
  }
  console.error('\n若确认非密钥（误报），可临时绕过：git commit --no-verify；但请先确认后再推。')
  process.exit(1)
}

console.log(STAGED ? '✅ 暂存区密钥扫描通过，未发现问题。' : '✅ 全仓密钥扫描通过，未发现问题。')
process.exit(0)
