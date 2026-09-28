#!/usr/bin/env node
/**
 * session-worktree —— 每个并行会话用各自的 linked worktree，从根上消掉"共享索引"这类事故。
 *
 * 一手事实（2026-09-28 本轮）：两个会话共用同一个工作目录 ⇒ 共用同一个 index。
 * 我改了 CHANGELOG.md 还没提交，另一个会话跑 `git add CHANGELOG.md` 时把我整份工作区内容
 * 一并暂存、写进了**它的**提交 —— 内容无误但署名错位，且我在自己这边完全看不出来。
 * 反向也成立：我 `git add` 时同样可能带走对方的在途改动
 * （本轮我靠"显式路径 + 断言暂存集 == 期望集"挡住了，但那是每笔都要人肉执行的纪律，
 *  不是机制 —— 这正是它还会复发的原因）。
 *
 * worktree 的隔离点是**每棵工作树有自己的 index**（.git/worktrees/<name>/index），
 * 所以 `git add` 在物理上无法触及另一棵树的暂存内容。代价：新树要各自 npm install。
 *
 * 用法：
 *   node scripts/session-worktree.mjs list
 *   node scripts/session-worktree.mjs add <名字>        # 从 origin/main 开 session/<名字>
 *   node scripts/session-worktree.mjs remove <名字>     # 拒绝在有未提交改动时静默删
 *   node scripts/session-worktree.mjs path <名字>
 * 退出码：0 成功 / 1 会损坏数据的动作被拒（未提交改动、重名等）/ 2 用法或环境不对
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// 本仓路径含中文：import.meta.url 的 pathname 是 percent-encoded（%E8%B6%85…），
// 直接拿去当文件系统路径用会指向一个不存在的目录 ⇒ 必须走 fileURLToPath 解码。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PARENT = path.resolve(ROOT, '..')
const WT_BASE = path.join(PARENT, '超市web-worktrees')

function die(code, msg) { console.error(`[session-worktree] ${msg}`); process.exit(code) }

/**
 * Windows 上 spawnSync('git', …) 直接 ENOENT —— Node 不查 PATHEXT，裸 'git' 解析不到 git.exe。
 * 显式补 .exe 就能走 shell:false，从而避开 Node 的 DEP0190 警告
 * （"shell:true 时参数不转义只拼接"——本脚本参数虽都是内部值/已过白名单校验，
 *   但不该让一个安全警告变成常态输出，那会让下一次真告警被淹没）。
 */
const GIT_BIN = process.env.GIT_BIN || (process.platform === 'win32' ? 'git.exe' : 'git')
function runGit(args, cwd = ROOT) {
  let r = spawnSync(GIT_BIN, args, { cwd, encoding: 'utf8' })
  if (r.error && (r.error.code === 'ENOENT' || r.error.code === 'EINVAL')) {
    r = spawnSync(GIT_BIN, args, { cwd, encoding: 'utf8', shell: true })  // 兜底：极端环境下再走 shell
  }
  if (r.error) die(2, `调不到 git：${r.error.message}（PATH 里没有 ${GIT_BIN}？可用 GIT_BIN 环境变量指定）`)
  return r
}
/** 会失败就停的取数（读历史、列树等） */
function git(args, cwd = ROOT) {
  const r = runGit(args, cwd)
  if (r.status !== 0) {
    die(2, `git ${args.join(' ')} 失败：${(r.stderr || r.stdout || '').trim().split('\n')[0]}`)
  }
  return (r.stdout || '').trim()
}
/** 存在性探针：命令失败返回 ''，**不**退出（否则"分支不存在"会把脚本自己打死） */
function gitOrEmpty(args, cwd = ROOT) {
  const r = runGit(args, cwd)
  return r.status === 0 ? (r.stdout || '').trim() : ''
}
const wtPath = (name) => path.join(WT_BASE, name)
const validName = (n) => /^[A-Za-z0-9._-]{1,40}$/.test(n)
  || die(2, '名字只允许 [A-Za-z0-9._-]{1,40}（它会变成目录名和分支名）')

function list() {
  const out = git(['worktree', 'list', '--porcelain'])
  const blocks = out.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  if (!blocks.length) { console.log('（没有任何 worktree）'); return }
  // 命中取第 1 组，不命中给空串（不用 `[, '']` 那种稀疏数组，本仓 lint 按 no-sparse-arrays 判）
  const cap = (re, s) => { const m = re.exec(s); return m ? m[1] : '' }
  for (const b of blocks) {
    const get = (k) => cap(new RegExp(`^${k} (.*)$`, 'm'), b)
    const p = get('worktree'), br = get('branch').replace('refs/heads/', '')
    const mine = path.resolve(p) === ROOT
    console.log(`${mine ? '主树  ' : '会话树'} ${p}   branch=${br || '(detached)'}`)
  }
  const n = blocks.filter((b) => path.resolve(cap(/^worktree (.*)$/m, b)) !== ROOT).length
  console.log(`\n会话树 ${n} 棵；基目录 ${WT_BASE}`)
}

function add(name) {
  validName(name)
  const target = wtPath(name)
  if (fs.existsSync(target)) die(1, `目录已存在：${target} ⇒ 拒绝覆盖（先 remove 或换个名字）`)
  if (gitOrEmpty(['rev-parse', '--verify', `refs/heads/session/${name}`])) {
    die(1, `分支 session/${name} 已存在 ⇒ 拒绝复用，避免把旧会话的提交带进来`)
  }
  git(['fetch', 'origin', 'main'])
  fs.mkdirSync(WT_BASE, { recursive: true })
  // --no-track：不跟 origin/main 绑，免得会话树里一次 `git push` 直接打到主线
  git(['worktree', 'add', '--no-track', '-b', `session/${name}`, target, 'origin/main'])
  console.log(`已建会话树：${target}`)
  console.log('下一步（新树没有 node_modules，门禁跑不起来）：')
  console.log(`  cd "${target}" && npm install --proxy null --https-proxy null`)
  console.log('发布前记得把分支合回 main，或按需 rebase origin/main。')
}

function remove(name) {
  validName(name)
  const target = wtPath(name)
  if (!fs.existsSync(target)) die(2, `没有这棵树：${target}`)
  const dirty = gitOrEmpty(['status', '--porcelain'], target)
  if (dirty) {
    const n = dirty.split('\n').filter(Boolean).length
    console.error(`[session-worktree] ${name} 有 ${n} 处未提交改动 ⇒ 拒绝删除。`)
    console.error('  正解由你决定这些改动的去留（提交 / stash / 明确丢弃），工具不替你删：')
    for (const l of dirty.split('\n').slice(0, 20)) console.error(`    ${l}`)
    process.exit(1)
  }
  const branch = `session/${name}`
  const unmerged = gitOrEmpty(['rev-list', '--count', `origin/main..${branch}`])
  if (unmerged && unmerged !== '0') {
    die(1, `${branch} 上有 ${unmerged} 个未进 origin/main 的提交 ⇒ 删树会连带删分支，先合回去或明确知道自己在丢`)
  }
  git(['worktree', 'remove', target])
  if (gitOrEmpty(['rev-parse', '--verify', `refs/heads/${branch}`])) git(['branch', '-D', branch])
  console.log(`已移除会话树与分支：${name}`)
}

const cmd = process.argv[2]
const arg = process.argv[3]
if (cmd === 'list') list()
else if (cmd === 'path') { if (!arg) die(2, '缺名字'); validName(arg); console.log(wtPath(arg)) }
else if (cmd === 'add') { if (!arg) die(2, '用法：add <名字>'); add(arg) }
else if (cmd === 'remove') { if (!arg) die(2, '用法：remove <名字>'); remove(arg) }
else die(2, '用法：node scripts/session-worktree.mjs <list|add|remove|path> [名字]')
