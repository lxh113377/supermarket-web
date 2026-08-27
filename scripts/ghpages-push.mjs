// 双模式部署脚本：Git Data API force push
// 用法：
//   默认：推 dist → lxh113377.github.io（微信端直接发布 dist）
//   --src：推源码 → lxh113377/supermarket-web（私有仓库，触发 dispatch 双发构建；需 repo scope PAT）
// 说明：base_tree 模式（新文件覆盖 + 未列旧文件保留）
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const TOKEN = process.env.GH_TOKEN
if (!TOKEN) { console.error('GH_TOKEN env required'); process.exit(1) }

const isSrc = process.argv.includes('--src')
const OWNER = 'lxh113377'
const REPO = isSrc ? 'supermarket-web' : 'lxh113377.github.io'
const BRANCH = 'main'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

// 源码模式：从项目根收集跟踪文件（排除构建产物/密钥/无关目录）
const ROOT = path.resolve(isSrc ? '.' : 'dist')
const EXCLUDES = ['node_modules', '.git', 'dist', '.wrangler', '.dev.vars', '.env',
  'memory', 'archive', 'docs', 'deliverables', '.workbuddy', '.trae', '.githooks',
  'tmp', 'team-briefs', 'documents', 'mem-patch', 'gh-pages-payload.json', '.aiexclude']

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'chaoshi-deploy',
}

async function api(method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`${method} ${p} -> ${r.status}: ${t.slice(0, 400)}`)
  }
  return r.json()
}

function walk(dir, base = '') {
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (EXCLUDES.includes(f)) continue
    const fp = path.join(dir, f)
    const rel = base ? `${base}/${f}` : f
    if (fs.statSync(fp).isDirectory()) out.push(...walk(fp, rel))
    else out.push(rel)
  }
  return out
}

async function main() {
  console.log(`目标: ${OWNER}/${REPO} (${isSrc ? '源码模式' : 'dist 模式'})`)
  console.log('Step 1/5: 获取当前 HEAD...')
  const ref = await api('GET', `/git/refs/heads/${BRANCH}`)
  const headSha = ref.object.sha
  const headCommit = await api('GET', `/git/commits/${headSha}`)
  const baseTreeSha = headCommit.tree.sha
  console.log('  HEAD:', headSha.slice(0, 7), 'base tree:', baseTreeSha.slice(0, 7))

  const files = walk(ROOT)
  console.log(`Step 2/5: 创建 ${files.length} 个 blobs（12 并发）...`)

  const tasks = files.map(async (rel) => {
    const buf = fs.readFileSync(path.join(ROOT, rel))
    const isBinary = buf.includes(0) || /\.(png|jpg|jpeg|webp|ico|gif)$/i.test(rel)
    const content = isBinary ? buf.toString('base64') : buf.toString('utf-8')
    const blob = await api('POST', '/git/blobs', {
      content,
      encoding: isBinary ? 'base64' : 'utf-8',
    })
    return { path: rel, mode: '100644', type: 'blob', sha: blob.sha }
  })
  const tree = []
  for (let i = 0; i < tasks.length; i += 12) {
    const batch = await Promise.all(tasks.slice(i, i + 12))
    tree.push(...batch)
    console.log(`  ${Math.min(i + 12, tasks.length)}/${tasks.length}`)
  }

  console.log('Step 3/5: 创建 tree (base_tree 模式)...')
  const newTree = await api('POST', '/git/trees', { base_tree: baseTreeSha, tree })

  console.log('Step 4/5: 创建 commit...')
  // commit message：优先 -m 参数，否则取本地 git HEAD subject（避免硬编码误导性 message 造成主线污染/分叉，坑 25）
  const mIdx = process.argv.indexOf('-m')
  let msg = mIdx >= 0 ? String(process.argv[mIdx + 1] || '') : ''
  if (!msg) { try { msg = execSync('git log -1 --format=%s').toString().trim() } catch {} }
  msg = msg || (isSrc ? 'sync source' : 'deploy')
  const message = `${msg} (ghpages ${new Date().toISOString()})`
  const commit = await api('POST', '/git/commits', {
    message,
    tree: newTree.sha,
    parents: [headSha],
  })

  console.log('Step 5/5: force update ref...')
  await api('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true })
  console.log('\n✅ DONE. New HEAD:', commit.sha)
  if (isSrc) console.log('   已触发 dispatch → github.io Actions 构建（2-5 分钟）')
  else console.log('   https://lxh113377.github.io/ (Pages 1-2 分钟生效)')
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1) })
