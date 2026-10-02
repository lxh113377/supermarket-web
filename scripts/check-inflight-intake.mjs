#!/usr/bin/env node
/**
 * inflight-intake —— 每轮开工把"工作树里未提交的在途件"采出来、归因、具名处置（第六十四轮 M-60-3）。
 *
 * 一手动因（跨两轮复发，因此按「复发计数」交判据而不交文字）：
 *   · 第六十轮：上一会话把 event_log 消费者写到一半（10 件在途，HEAD 停在它开工之前），
 *     本轮靠 `git status` 人肉发现并接管；§7 第 5 条明确记账「本轮只接管，没修机制」，
 *     理由写得很长：这条要动的是**每轮开工动作本身**，拿一次收尾当"机制已建"是自我表扬。
 *   · 第六十四轮（本轮）：同一形态第二次发生 —— `src/components/OrdersTab.tsx` 在途 86 行
 *     （正是第六十二轮 §8 那条 P0「管理端时间线 UI 接线」），mtime 落后 HEAD 9 小时，
 *     而 §8 / 内层主卷 / 现有三件最接近的闸（`verify:pointers` 判轮次、`check-head-closure` 判链引用、
 *     `check-judge-side-effects` 判判据写盘）**取数面都不含工作树** ⇒ 它在系统里不存在。
 *     下一轮不带记忆的人照 §8 开工，会把它当没有，然后要么重做第二遍，要么把它改回原样。
 *
 * 本件只回答三件事，且每件都可复算：
 *   ① 有哪些在途件 —— 两面各出一行分母（`status --porcelain -z` 与 `ls-files --others --exclude-standard -z`），
 *      两面不等时不许只报其中一个（同一事实两处取数就要对账，户内「漏扫与扫过不得同形」）。
 *   ② 它归谁 —— 按**内容**不按状态列：状态面（`status --porcelain -z`）与内容面
 *      （`diff --name-only -z HEAD`）两把尺各读一次，报脏而内容未变者记幻影。
 *      `git status` 的 ` M` 可能是行尾归一的幻影（本机 `core.autocrlf=true` 实测就在本报脏），
 *      把幻影读成真改动会让人去"修"一个不存在的问题。
 *   ③ 它是否被本轮认领 —— 只问「内层 07 主卷最新一节有没有点名这个路径」。
 *      刻意**不**问"历史上提过没有"：实测 `OrdersTab` 在 `CHANGELOG@HEAD~1` 命中 9 次、
 *      在 `memory/07-next-steps*.md` 全集命中 5 次 —— 那种口径对任何真组件都恒答"已认领"，
 *      是一条没有牙齿的判据（本轮设计阶段把它否证后换掉的，留此防第三次造它）。
 *
 * 处置档只有两态且各自给可复跑动作：`无主` ⇒ 要么提交它、要么在本轮 07 节写下这个路径；
 * `已认领` ⇒ 本轮已接手，收尾时必须出现在提交里。
 *
 * 为什么 advisory（rc 永不 1，也不进 `verify`/CI）：
 *   · 它读的是**本机工作树**，CI 的 checkout 永远是干净树 ⇒ 在 CI 上它恒答"0 件在途"，
 *     那是一枚把"没对象"渲染成"通过"的假绿闸（户内：量不到不得折算成达标）。
 *   · 第六十轮 §8 第三条原话：「先给一条 advisory 命令，别一上来就拦提交」；
 *     升闸要等它先攒下读数与误报率，且升闸动作本身要另立一轮。
 *   · 同理 `check-head-closure.mjs` 已为 `session-worktree.mjs` 立过"人工件不入链"的具名豁免先例。
 *
 * 退出码：0 = 取数面采到了（**包括** 0 件在途这一合法结果）/ 2 = 取数面坏了（git 解不动、
 * 07 主卷读不到）⇒ UNVERIFIED，绝不把"我读不到"交回成"工作树干净"。
 *
 * `--root=<目录>`：把被审树指到别处（缺省＝本脚本所在仓）。加它不是为了好看 ——
 * 没有它，夹具只能断言门面行的**形状**，而形状断言抓不到"两面都读漏了"这类真缺陷；
 * 有了它，夹具可以在一次性 git 仓里造出确凿的 differs / untracked / 认领翻转三种态各一行分母。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPAWN_BUDGET_MS = 5_000
/** 内层记忆主卷 —— 认领判据的唯一取数文件（分卷不参与：最新一节只在主卷，并卷历史不算本轮认领）。 */
const POINTER_MAIN = 'memory/07-next-steps.md'

/** Windows 上 spawnSync('git') 直接 ENOENT（Node 不查 PATHEXT），补 .exe 才能走 shell:false。 */
function gitFile() {
  const probe = spawnSync(process.env.GIT_EXE || 'git.exe', ['--version'], {
    encoding: 'utf8', timeout: SPAWN_BUDGET_MS,
  })
  if (probe.status === 0) return 'git.exe'
  const plain = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: SPAWN_BUDGET_MS })
  return plain.status === 0 ? 'git' : null
}

function makeGit(gitExe, root) {
  return function git(args) {
    const r = spawnSync(gitExe, ['-C', root, ...args], { encoding: 'utf8', timeout: SPAWN_BUDGET_MS })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} rc=${r.status}: ${(r.stderr || '').trim().split('\n')[0]}`)
    return r.stdout || ''
  }
}

/** `status --porcelain -z`：NUL 分隔，`XY <space> path`；改名是 `R  new\0old` 两段。
 *  改名条目**照单收但标盲区**（`rename:true`）：本仓工作流不用 git 改名，出现即点名，
 *  绝不当成"0 件在途"吞掉（户内：盲区给独立状态，禁只报扫过的半边）。 */
export function parsePorcelainZ(out) {
  const rows = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line || line.length < 4) continue
    const xy = line.slice(0, 2)
    const p = line.slice(3)
    if (xy[0] === 'R' || xy[1] === 'R') {
      rows.push({ xy, path: p, untracked: false, rename: true })
      i += 1
      continue
    }
    rows.push({ xy, path: p, untracked: xy === '??', rename: false })
  }
  return rows
}

/** 两面分母对账：A=status（含 ??），B=ls-files --others（只含未跟踪）。 */
export function reconcileFaces(aRows, bList) {
  const aUntracked = aRows.filter((r) => r.untracked).map((r) => r.path).sort()
  const b = [...bList].sort()
  const onlyA = aUntracked.filter((f) => !b.includes(f))
  const onlyB = b.filter((f) => !aUntracked.includes(f))
  return { aUntracked: aUntracked.length, bUntracked: b.length, onlyA, onlyB, equal: onlyA.length === 0 && onlyB.length === 0 }
}

/**
 * 内容档（不看状态列）。
 * `same` = git 报脏但**内容通道**（`diff --name-only HEAD`）里没有它 ⇒ 行尾归一幻影，不是改动。
 * 为什么不用 `git hash-object` 自己算 OID 比：`hash-object` 不带 `-w` 时是否套 clean 过滤器
 * 取决于 `--path` 是否给出，一旦套错一档，本机 `core.autocrlf=true` 下每个合法文件都会被判成
 * "有改动"——幻影判据就是这么造出来的。改走 git 自己的内容通道，过滤规则由 git 单源决定。
 */
export function contentState(xy, inContentDiff) {
  if (xy === '??') return 'untracked'
  if (inContentDiff) return 'differs'
  return 'same'
}

/** 龄期档：mtime 与 HEAD 提交时刻比，给方向与小时差（12h 内不判"遗留"，防把并发在途误判成无主旧件）。 */
export function ageBand(mtimeMs, headMs, staleHours = 12) {
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(headMs)) return { band: 'unknown', hours: null }
  const diffH = (headMs - mtimeMs) / 3_600_000
  if (diffH <= 0) return { band: 'after-HEAD', hours: Math.round(-diffH * 10) / 10 }
  if (diffH >= staleHours) return { band: 'stale-before-HEAD', hours: Math.round(diffH * 10) / 10 }
  return { band: 'recent-before-HEAD', hours: Math.round(diffH * 10) / 10 }
}

/** 认领档：只认「主卷最新那一节」里的路径具名。 */
export function adoptionOf(fileName, latestSection) {
  if (latestSection === null || latestSection === undefined) return { state: 'UNVERIFIED', hits: 0 }
  return { state: latestSection.includes(fileName) ? 'claimed' : 'unclaimed', hits: latestSection.split(fileName).length - 1 }
}

/** 主卷的「本轮认领面」= 最后一个**轮次节**（标题含「第N轮」）到下一个 `^## ` 或文件尾。
 *
 *  一手缺陷（本件首跑即咬到，第六十四轮）：主卷结构是
 *  `## 2026-10-02 — 第六十二轮（…）` → `## 更早轮次…的指针` → `## 分卷目录`，
 *  若按"最后一个 `^## `"取，拿到的是「分卷目录」那一节 —— 里面只有卷号、永远不会点名源文件，
 *  于是每一条在途件都被判成无主，判据看着很严其实是锚错了面。 */
export function latestSectionOf(md) {
  const lines = md.split(/\r?\n/)
  const ROUND_HEAD = /^## \d{4}-\d{2}-\d{2}.*第[零一二三四五六七八九十百]{1,6}\s*轮/
  let start = -1
  for (let i = 0; i < lines.length; i++) if (ROUND_HEAD.test(lines[i])) start = i
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break }
  return lines.slice(start, end).join('\n')
}

/** 门面行：files 是"内容确有差异或新增"的件数（幻影脏不计），unclaimed 是待处置数。 */
export function faceLine({ rc, files, claimed, unclaimed, faces, phantom, blind, parseFail }) {
  const tag = rc === 0 ? 'GATE-PASS' : 'GATE-UNVERIFIED'
  return `[GATE:inflight-${rc === 0 ? 'ok' : 'unverified'}] ${tag} inflight-intake :: rc=${rc}`
    + ` files=${files} claimed=${claimed} unclaimed=${unclaimed} phantom=${phantom}`
    + ` blind_rename=${blind}`
    + ` face=status∪diff∪ls-files(未跟踪 A${faces.aUntracked}/B${faces.bUntracked}${faces.equal ? ' 合' : ' 不合'})`
    + (parseFail ? ` parse_fail=${parseFail}` : '')
}

export function collect({ gitExe = null, staleHours = 12, root = ROOT } = {}) {
  const exe = gitExe || gitFile()
  if (!exe) return { rc: 2, why: '本机取不到可用的 git（git.exe 与 git 两条通道都失败）⇒ 无对象可判，不折算成"工作树干净"' }
  const git = makeGit(exe, root)
  let porcelain, others, contentSet, headMs, pointerMd
  try {
    const top = git(['rev-parse', '--show-toplevel']).trim()
    if (!top) throw new Error('--show-toplevel 返回空')
    porcelain = parsePorcelainZ(git(['status', '--porcelain', '-z']))
    others = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
    // 内容面：走 git 自己的 clean 过滤器 ⇒ 行尾归一造成的假脏在这里不出现（幻影的定义面）
    contentSet = new Set(git(['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean))
    headMs = Date.parse(git(['log', '-1', '--format=%cI']).trim())
  } catch (e) {
    return { rc: 2, why: `取数面失败（未打到结论）：${e.message}` }
  }
  try {
    pointerMd = readFileSync(path.join(root, POINTER_MAIN), 'utf8')
  } catch (e) {
    return { rc: 2, why: `${POINTER_MAIN} 读不到（认领判据没有取数面）：${String(e.message || e).split('\n')[0]}` }
  }
  const section = latestSectionOf(pointerMd)
  if (section === null) return { rc: 2, why: `${POINTER_MAIN} 里一个 "^## " 节标题都取不到 ⇒ "最新一节"无从定义，不据空面判认领` }

  const rows = []
  for (const r of porcelain) {
    let mtimeMs = Number.NaN
    try { mtimeMs = statSync(path.join(root, r.path)).mtimeMs } catch { /* 已删除/改名旧路径走 unknown 档 */ }
    rows.push({
      path: r.path, xy: r.xy,
      content: r.rename ? 'rename-blind' : contentState(r.xy, contentSet.has(r.path)),
      age: ageBand(mtimeMs, headMs, staleHours),
      adoption: adoptionOf(path.basename(r.path), section),
      blind: !!r.rename,
    })
  }
  const recon = reconcileFaces(porcelain, others)
  return { rc: 0, rows, faces: recon, headMs, sectionTitle: section.split('\n')[0] }
}

export function selftest() {
  const rows = []
  const t = (name, got, want) => rows.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })

  t('status -z 解析：M 行 / ?? 行各一条',
    parsePorcelainZ(' M src/a.ts\0?? src/b.ts\0').map((r) => `${r.xy}|${r.path}`),
    [' M|src/a.ts', '??|src/b.ts'])
  const ren = parsePorcelainZ('R  src/new.ts\0src/old.ts\0 M src/c.ts\0')
  t('status -z 解析：改名吃掉配对的旧路径 ⇒ 只剩 2 条（新路径 + M 行）', ren.length, 2)
  t('改名条目照单收但标盲区，不被静默丢弃', ren[0].rename, true)
  t('status -z 空输入 ⇒ 0 行（这是"量到零"，不是"读不到"）', parsePorcelainZ('').length, 0)

  t('两面分母：A 有 ??、B 也有 ⇒ 合',
    reconcileFaces([{ xy: '??', path: 'x', untracked: true }], ['x']).equal, true)
  const fork = reconcileFaces([{ xy: '??', path: 'x', untracked: true }], ['y'])
  t('两面分母：A 报 x 而 B 报 y ⇒ 不合，且两侧各点名（不许只报一个 0）',
    [fork.equal, fork.onlyA, fork.onlyB], [false, ['x'], ['y']])

  t('内容档：?? ⇒ untracked', contentState('??', false), 'untracked')
  t('内容档：状态面脏而内容面没有 ⇒ same（行尾归一幻影）', contentState(' M', false), 'same')
  t('内容档：内容面也认 ⇒ differs', contentState(' M', true), 'differs')
  t('反向自证：幻影档必须由内容面决定（内容面恒真时 same 永不出）',
    contentState(' M', true) === 'same', false)

  const H = 3_600_000
  t('龄期：mtime 晚于 HEAD ⇒ after-HEAD', ageBand(2_000 + H, 2_000).band, 'after-HEAD')
  t('龄期：早 9 小时 ⇒ stale（默认阈 12h 之下则算 recent）', ageBand(0, 9 * H, 12).band, 'recent-before-HEAD')
  t('龄期：早 12 小时整 ⇒ stale（边界取 >=，写成 > 就是自造一条永不误报的缝）', ageBand(0, 12 * H, 12).band, 'stale-before-HEAD')
  t('龄期：mtime 取不到 ⇒ unknown，不折算成"很旧"', ageBand(Number.NaN, 5).band, 'unknown')

  const sec = '## 2026-10-03 — 第六十四轮\n\n- 接管 `src/components/OrdersTab.tsx`\n'
  t('认领：本轮节里点名 ⇒ claimed', adoptionOf('OrdersTab.tsx', sec).state, 'claimed')
  t('认领：本轮节里没点名 ⇒ unclaimed（历史别处提过不算）', adoptionOf('SecretPanel.tsx', sec).state, 'unclaimed')
  t('认领：节面为 null ⇒ UNVERIFIED，绝不答 unclaimed', adoptionOf('x.tsx', null).state, 'UNVERIFIED')

  const shell = '## 2026-09-30 — 第六十一轮（旧）\n\np1\n## 2026-10-02 — 第六十二轮（新）\n\np2\n## 更早轮次的指针\n\nold\n## 分卷目录\n\n卷号 1–123\n'
  t('认领面锚在**最后一个轮次节**，不是最后一个 ^## 标题', latestSectionOf(shell).trim().startsWith('## 2026-10-02'), true)
  t('反向自证：分卷目录/更早轮次那两节不得被当成本轮面卷进来（本件首跑咬到的真缺陷）',
    [latestSectionOf(shell).includes('卷号'), latestSectionOf(shell).includes('old')], [false, false])
  t('轮次节内文可被点名检索', latestSectionOf(shell).includes('p2'), true)
  t('一个轮次标题都没有 ⇒ null（取数面坏，绝不退化成"全都没被认领"）', latestSectionOf('## 分卷目录\n\nx\n'), null)
  t('锚点是"日期 + 第N轮"两条一起：只有第N轮没有日期前缀的结构节不算（主卷真有这行）',
    latestSectionOf('## 2026-10-02 — 第六十二轮\n\np2\n## 更早轮次（第五十四轮及以前）的指针\n\n卷 48\n').includes('卷 48'), false)

  const mk = (rc, extra) => faceLine({
    rc, files: 0, claimed: 0, unclaimed: 0, phantom: 0, blind: 0, parseFail: 0,
    faces: { aUntracked: 0, bUntracked: 0, equal: true }, ...extra,
  })
  const bad = mk(2)
  t('门面行：rc=2 走 GATE-UNVERIFIED 且印 rc=2（"读不到"不得长得像"通过"）',
    [bad.includes('GATE-UNVERIFIED'), bad.includes('rc=2')], [true, true])
  const ok0 = mk(0)
  t('门面行：rc=0 且 0 件 ⇒ GATE-PASS files=0（真·干净树是合法读数）',
    [ok0.includes('GATE-PASS'), ok0.includes('files=0')], [true, true])
  t('门面行：盲区计数进得出（blind_rename=3 必须印出来，禁把盲区折进 files）',
    mk(0, { blind: 3 }).includes('blind_rename=3'), true)
  return rows
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    const rows = selftest()
    let fail = 0
    for (const r of rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} :: ${r.name} got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`) }
    console.log(`${fail === 0 ? 'GATE-PASS' : 'GATE-FAIL'} inflight-selftest :: ${rows.length - fail}/${rows.length} 通过，${fail} 失败`)
    return fail === 0 ? 0 : 1
  }
  const staleHours = Number((argv.find((a) => a.startsWith('--stale-hours=')) || '').split('=')[1] || 12)
  const rootArg = (argv.find((a) => a.startsWith('--root=')) || '').split('=').slice(1).join('=')
  const root = rootArg ? path.resolve(rootArg) : ROOT
  const res = collect({ staleHours, root })
  if (res.rc === 2) {
    process.stderr.write(`[inflight] 取数面未通（root=${root}）：${res.why}\n`)
    process.stdout.write(faceLine({
      rc: 2, files: 0, claimed: 0, unclaimed: 0, phantom: 0, blind: 0, parseFail: 0,
      faces: { aUntracked: '?', bUntracked: '?', equal: false },
    }) + '\n')
    return 2
  }
  const quiet = argv.includes('--quiet')
  const phantom = res.rows.filter((r) => r.content === 'same').length
  const blind = res.rows.filter((r) => r.blind).length
  const real = res.rows.filter((r) => r.content === 'differs' || r.content === 'untracked')
  const claimed = real.filter((r) => r.adoption.state === 'claimed').length
  const unclaimed = real.filter((r) => r.adoption.state === 'unclaimed').length
  if (!quiet) {
    process.stdout.write(`[inflight] 被审树 root=${root}\n`)
    process.stdout.write(`[inflight] 认领判据取数面：${POINTER_MAIN} 最新一节 =「${res.sectionTitle.replace(/^## /, '')}」\n`)
    if (!res.rows.length) process.stdout.write('[inflight] 工作树无在途件（两面分母均为 0；这是量到零，不是没量）\n')
    for (const r of res.rows) {
      process.stdout.write(
        `[inflight] ${r.path} :: 态=${r.xy.trim() || '??'} 内容=${r.content}`
        + ` 龄=${r.age.band}${r.age.hours === null ? '' : `(${r.age.hours}h)`}`
        + ` 认领=${r.adoption.state}${r.adoption.hits ? `(命中 ${r.adoption.hits})` : ''}\n`)
    }
    for (const f of (res.faces.onlyA.length ? res.faces.onlyA : res.faces.onlyB)) {
      process.stderr.write(`[inflight] 两面分母不合：${f} 只在一面出现 ⇒ 其中一面读漏了，先归因再取用本件结论\n`)
    }
    if (blind) process.stderr.write(`[inflight] 盲区：改名条目 ${blind} 条本件不逐条判（只点名不折进 files）⇒ 出现即说明有人在动文件名，先人工看再取用本件结论\n`)
    if (unclaimed) {
      process.stdout.write(`[inflight] 处置：${unclaimed} 件无主 ⇒ 要么提交它，要么在本轮 07 节写下其文件名（写下即认领）\n`)
    }
    process.stdout.write('[inflight] advisory：本件不进 verify 链也不进 CI（CI 的 checkout 恒为干净树，量不到不等于达标）\n')
  }
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rc: res.rc, rows: res.rows, faces: res.faces, sectionTitle: res.sectionTitle }, null, 2) + '\n')
  }
  process.stdout.write(faceLine({ rc: 0, files: real.length, claimed, unclaimed, faces: res.faces, phantom, blind, parseFail: 0 }) + '\n')
  return 0
}

const isCli = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(await main())
