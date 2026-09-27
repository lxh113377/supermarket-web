// 覆盖透明化（借鉴门店项目 quality_gate.py 的「未纳入门禁的测试文件」输出）
// 目的：让 scripts/ 下"既不跑也不删"的脚本盲区可见，杜绝"看起来门禁很全、实际无人执行"。
// 不阻断（退出码恒为 0）——只做暴露，处置由人决定。
import { readdirSync, readFileSync, existsSync } from 'node:fs'
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
// 取数面 = npm scripts ∪ .githooks/* ∪ .github/workflows/*.yml。
// 第二十五轮补：只看 package.json 会把 `ci-green-contract.mjs` 误报成"没人调的脚本"——
// 它其实每次推送都被 .githooks/pre-push 调（而且正是那条闸在管推送）。"盲区可见"的工具自己
// 声明了过窄的可见面，就会生产假盲区；判"没人引用"之前必须先把引用面列全（同族教训见 R24）。
const refBlobs = [blob]
for (const dir of [join(root, '.githooks'), join(root, '.github', 'workflows')]) {
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir)) refBlobs.push(readFileSync(join(dir, f), 'utf8'))
}
const refBlob = refBlobs.join('\n')
const uncovered = files.filter((f) => !refBlob.includes(`scripts/${f}`))

// 运维手动脚本：需人工判断时机（会改远端/重写历史），刻意不挂 npm script、不纳入 verify
const MANUAL_ONLY = new Set(['git-push-fallback.ps1', 'purge-admin-key-history.sh'])

const effective = uncovered.filter((f) => !MANUAL_ONLY.has(f))
console.log(`[覆盖透明化] scripts/ 共 ${files.length} 个文件`)
if (MANUAL_ONLY.size && uncovered.length !== effective.length) {
  console.log(`[覆盖透明化] 运维手动脚本（刻意不纳入，需人工触发）：${[...MANUAL_ONLY].join('、')}`)
}
if (effective.length) {
  console.log(`[覆盖透明化] 未被任何 npm script / git hook / CI workflow 引用（${effective.length}）：${effective.join('、')}`)
  console.log('[覆盖透明化] 处置建议：有价值者挂到 package.json scripts（verify:xxx / maintain:xxx）；一次性者移入 archive/')
} else {
  console.log('[覆盖透明化] 全部脚本均已被 npm script / git hook / CI workflow 引用，或标注为运维手动')
}

// 从 verify 链里实解析，避免硬编码集合随门禁扩充而过期（曾导致 check:cycles/verify:contract 被误列为"未纳入"）
const chain = pkg.scripts.verify || ''
const verifyChain = [
  ...[...chain.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]),
  ...[...chain.matchAll(/npm (test|start)(?![\w:-])/g)].map((m) => m[1]), // verify 链里写作 `npm test`
]
const inVerify = new Set(['verify', ...verifyChain])
const outOfVerify = Object.keys(pkg.scripts).filter((k) => !inVerify.has(k))
console.log(`[覆盖透明化] 未纳入 verify 的 npm 脚本：${outOfVerify.join('、')}（dev/preview 为本地命令；build 由 CI 单独执行；smoke 为部署后冒烟）`)
