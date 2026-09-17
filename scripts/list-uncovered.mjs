// 覆盖透明化（借鉴门店项目 quality_gate.py 的「未纳入门禁的测试文件」输出）
// 目的：让 scripts/ 下"既不跑也不删"的脚本盲区可见，杜绝"看起来门禁很全、实际无人执行"。
// 不阻断（退出码恒为 0）——只做暴露，处置由人决定。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const blob = Object.values(pkg.scripts).join(' ')

const scriptsDir = join(root, 'scripts')
const files = readdirSync(scriptsDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .sort()
const uncovered = files.filter((f) => !blob.includes(`scripts/${f}`))

// 运维手动脚本：需人工判断时机（会改远端/重写历史），刻意不挂 npm script、不纳入 verify
const MANUAL_ONLY = new Set(['git-push-fallback.ps1', 'purge-admin-key-history.sh'])

const effective = uncovered.filter((f) => !MANUAL_ONLY.has(f))
console.log(`[覆盖透明化] scripts/ 共 ${files.length} 个文件`)
if (MANUAL_ONLY.size && uncovered.length !== effective.length) {
  console.log(`[覆盖透明化] 运维手动脚本（刻意不纳入，需人工触发）：${[...MANUAL_ONLY].join('、')}`)
}
if (effective.length) {
  console.log(`[覆盖透明化] 未被任何 npm script 引用（${effective.length}）：${effective.join('、')}`)
  console.log('[覆盖透明化] 处置建议：有价值者挂到 package.json scripts（verify:xxx / maintain:xxx）；一次性者移入 archive/')
} else {
  console.log('[覆盖透明化] 全部脚本均已被 npm script 引用或标注为运维手动')
}

const inVerify = new Set(['scan:secrets', 'lint', 'typecheck', 'test', 'verify:backend', 'verify'])
const outOfVerify = Object.keys(pkg.scripts).filter((k) => !inVerify.has(k))
console.log(`[覆盖透明化] 未纳入 verify 的 npm 脚本：${outOfVerify.join('、')}（dev/preview 为本地命令；build 由 CI 单独执行；smoke 为部署后冒烟）`)
