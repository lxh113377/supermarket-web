#!/usr/bin/env node
/**
 * 行尾纯度判据（第五十一轮 R51-H6）—— .gitattributes 的**行为回执**。
 *
 * 为什么不是"有 .gitattributes 就算这项能力有了"：既有规「配置类能力位必须配行为回执」
 * （心屿 SoulIsle 对标轮 r37 的 dependabot 教训——配了不等于在用）。本仓的对应形态是
 * 「`.gitattributes` ⇒ 工作树字节==blob 的常驻判据」，而这里取的是**更强的一侧**：
 * 直接断言 **blob 里没有 CRLF**。blob 是 git 决定的量 ⇒ 换任何 `core.autocrlf` 配置的 clone
 * 都能复算，不会像上一轮那个"本机 205 / CI 224"的台账数字一样第一次接 CI 就自判红。
 *
 * 一手动因（本轮实测，723 个跟踪件全量取，不按行窗口）：
 *   - **60 个文本件的 blob 里带 CRLF**（含 `scripts/verify_images.py`、`src/data/products-seed.ts`、
 *     20 个 .tsx）⇒ 同一提交在另一台机器上检出就是另一种字节形态；
 *   - **100 个二进制件（.webp/.png）的字节里出现 0D0A** ⇒ 没有 binary 名单的"归一化"
 *     会把它们当行尾剥掉，且"两侧都归一再比"**看不见这个内容损失**（两侧同样破坏、差值为零）。
 *   所以本判据同时核三件事：属性表在册且被 git 解析生效（E1）、文本 blob 零 CRLF（E2）、
 *   分母闭合 text + binary == 全跟踪数（E3，防"少扫一面"被读成"扫过且干净"）。
 *
 * 退出码：0=GREEN / 1=判红 / 2=取不到 git 现场（环境未验，不得与"判红"或"通过"混写）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ATTR = '.gitattributes'

const git = (args, opts = {}) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'buffer', ...opts })

/**
 * `git ls-files --eol` 一次性给出每个跟踪件的**属性解析结果**与 **git 自己的行尾小结**
 * （`i/lf`、`i/crlf`、`i/mixed`、`i/-text`）。
 * 用 git 的结论而不是自己读 .gitattributes 猜：表写了但没生效（被 info/attributes 覆盖、
 * 模式写错）与"表没写"是两种缺陷，只有 git 知道答案。
 * `i/*` 同时当**第二条独立通道**用 —— 它必须与我逐字节扫出的 CRLF 集合相等（E3），
 * 两条互不依赖的观测法给出不同答案 ⇒ 不许任何一侧宣布"干净"。
 */
function classified() {
  const r = git(['ls-files', '--eol', '-z'])
  if (r.status !== 0) return null
  const out = []
  for (const rec of r.stdout.toString('utf8').split('\0')) {
    if (!rec) continue
    const tab = rec.indexOf('\t')
    if (tab === -1) continue
    const meta = rec.slice(0, tab)
    const path = rec.slice(tab + 1)
    const attr = ((/attr\/(\S*)/.exec(meta)) || [])[1] ?? ''
    const iEol = ((/^\S*?(i\/[a-z-]+)/.exec(meta.trim())) || [])[1] ?? ''
    out.push({ path, binary: attr.includes('-text') || attr.includes('binary'), iEol })
  }
  return out
}

/**
 * 一次 `git cat-file --batch` 取回所有 blob 的**字节**（逐文件 spawn 会跑 723 个进程）。
 * 取的是 **index 侧**（`:<path>`）而不是 `HEAD:<path>`：判据要能在"这笔提交正在修这个问题"
 * 时判绿，否则修复它的那一笔永远红（既有规：一次正常提交变不了绿的判据没资格当闸）。
 * CI 是 `checkout` 之后跑，index == HEAD ⇒ 两侧答案相同，这不放宽任何判定。
 * 返回 path → Buffer；取不到的记进 failures（不得当成"没有 CRLF"）。
 */
function blobBytes(entries) {
  // 两条实测踩出来的限制（第一版就崩在这里，rc=null、stderr 全空）：
  //   ① spawnSync 的 maxBuffer 默认 1MB —— 把 249 个二进制（webp/png）一起批读会超，
  //      进程被杀 ⇒ rc=null。二进制本来就不判行尾，**根本不进这批**。
  //   ② 文本面也要给足余量（seed 与 dist 类大件），取 256MB。
  const texts = entries.filter((e) => !e.binary)
  const input = Buffer.from(texts.map((e) => `:${e.path}\n`).join(''), 'utf8')
  const r = git(['cat-file', '--batch'], { input, maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) return { map: null, failures: [`git cat-file --batch rc=${r.status}: ${r.stderr.toString('utf8').slice(0, 160)}`] }
  const map = new Map()
  const failures = []
  const buf = r.stdout
  let i = 0
  let idx = 0
  while (i < buf.length && idx < entries.length) {
    const nl = buf.indexOf(0x0a, i)
    if (nl === -1) break
    const header = buf.subarray(i, nl).toString('utf8')
    i = nl + 1
    if (header.endsWith(' missing')) {
      failures.push(`${texts[idx].path}（blob 不在库里）`)
      idx += 1
      continue
    }
    const parts = header.split(' ')
    const size = Number(parts[2])
    const body = buf.subarray(i, i + size)
    i += size + 1
    map.set(texts[idx].path, body)
    idx += 1
  }
  if (idx !== texts.length) failures.push(`批读在第 ${idx} 件处提前结束（应有 ${entries.length} 件）⇒ 分母不完整`)
  return { map, failures }
}

/**
 * 纯判据。E4（工作树侧）只报不判：别人正在改的文件不该被我的闸连坐
 * （既有规：断言范围==爆炸半径）。
 */
export function evaluate({ attrText, attrPresent, entries, blobs, blobFailures = [], worktreeCrlf = 0, worktreeTotal = 0,
  worktreeGitCrlf = null, autocrlf = '', editorconfigText = '', editorconfigPresent = false }) {
  const rows = []
  const push = (id, ok, detail, unverified = false, advisory = false) => rows.push({ id, ok, unverified, advisory, detail })

  const hasAutoLf = /^\*\s+text=auto\s+eol=lf\s*$/m.test(attrText || '')
  const binaryRules = [...new Set([...(attrText || '').matchAll(/^\*\.([a-z0-9]+)\s+binary\s*$/gmi)].map((m) => m[1].toLowerCase()))]
  const binaryPaths = entries.filter((e) => e.binary)
  const unruledBinary = [...new Set(binaryPaths.map((e) => ((e.path.match(/\.([a-z0-9]+)$/i)) || [])[1]?.toLowerCase() ?? ''))]
    .filter((ext) => ext && !binaryRules.includes(ext))

  push('E1', attrPresent && hasAutoLf && unruledBinary.length === 0,
    attrPresent
      ? `属性表在册且被 git 解析生效：\`* text=auto eol=lf\` ${hasAutoLf ? '在' : '**缺**'}｜`
        + `binary 规则 ${binaryRules.length} 条｜实际被 git 判为二进制的扩展名 ${binaryPaths.length} 件`
        + (unruledBinary.length ? `；**未具名的二进制扩展名**: ${unruledBinary.join(', ')}（靠启发式=下次加个新资产就悄悄归一化）` : '')
      : `.gitattributes 不存在 ⇒ 检出形态仍由每台机器的 core.autocrlf 决定`,
    !attrPresent)

  const texts = entries.filter((e) => !e.binary)
  const offenders = []
  const unread = []
  for (const e of texts) {
    const b = blobs.get(e.path)
    if (b === undefined) { unread.push(e.path); continue }
    if (b.includes('\r\n')) offenders.push(e.path)
  }
  push('E2', blobs.size > 0 && unread.length === 0 && offenders.length === 0,
    `文本 blob ${texts.length} 件里 CRLF -bearing **${offenders.length} 件**`
      + (offenders.length ? `（前 12 件: ${offenders.slice(0, 12).join(', ')}）` : '')
      + (unread.length ? `；另有 ${unread.length} 件 blob 没取到 ⇒ 分母不完整，不判"干净"（${unread.slice(0, 5).join(', ')}）` : ''),
    blobs.size === 0 || unread.length > 0)

  const closed = entries.length > 0 && texts.length + binaryPaths.length === entries.length
  // 两条独立通道：我逐字节扫出的 CRLF 集 ⇄ git 自己 `i/crlf|i/mixed` 报出来的集。
  // 只有一条腿的"零命中"不可信（既有规：全零/独有结论必须有第二条互不依赖的观测法）。
  const gitCrlf = new Set(texts.filter((e) => e.iEol === 'i/crlf' || e.iEol === 'i/mixed').map((e) => e.path))
  const mine = new Set(offenders)
  const onlyGit = [...gitCrlf].filter((p) => !mine.has(p))
  const onlyMine = [...mine].filter((p) => !gitCrlf.has(p))
  const channelsAgree = onlyGit.length === 0 && onlyMine.length === 0
  push('E3', closed && channelsAgree && blobFailures.length === 0,
    `分母闭合：跟踪 ${entries.length} = 文本 ${texts.length} + 二进制 ${binaryPaths.length}`
      + `（blob 批读失败 ${blobFailures.length} 条${blobFailures.length ? `：${blobFailures.slice(0, 3).join(' ｜ ')}` : ''}）`
      + `｜双通道对账：逐字节扫到 ${mine.size} 件、git ` + '`i/*`' + ` 报 ${gitCrlf.size} 件`
      + (channelsAgree ? ' ⇒ 两侧一致' : ` ⇒ **不一致**（只 git 知道 ${onlyGit.length} 件: ${onlyGit.slice(0, 4).join(', ')}；只我知道 ${onlyMine.length} 件: ${onlyMine.slice(0, 4).join(', ')}）`)
      + (closed ? '' : ' ⇒ **恒等式不成立**，本面少扫了东西，任何"零命中"都不作数'))

  // —— 三把尺分档印（第五十四轮：同一件事有三种量法，混在一行就会被读成"这一维没人管"或"这一维能拦"）。
  // 尺①blob 侧＝E2/E3（拦提交）；尺②字节含 CR 的检出面＝E4（只报）；尺③git 工作树行尾口径＝E6（只报）。
  // E4/E6 真判它 = 把并行会话的在途改动、把每台机器的 core.autocrlf 算成我的红（既有规：断言范围==爆炸半径；
  // 且本机实测过：归一后 blob 逐件相同而 status 仍报脏 ⇒ 拿它当闸＝要求提交一笔不存在的改动，不可自愈）。
  push('E4', true,
    `尺②检出字节面（advisory・**拦提交=否**）：${worktreeCrlf}/${worktreeTotal} 件磁盘字节含 CRLF`
      + '（其中含二进制里合法的 `0D0A`，本尺与 blob 侧不同口径，不可相加）',
    false, true)

  // E5＝写侧两处声明必须同向。这是**可自愈**的一条（改任一处即绿），所以它有资格拦提交；
  // 读不到任何一侧 ⇒ UNVERIFIED，不得判"一致"（盲区≠零）。
  const attrDeclares = hasAutoLf ? 'lf' : null
  const ecMatch = /^\s*end_of_line\s*=\s*(\w+)\s*$/m.exec(editorconfigText || '')
  const ecDeclares = editorconfigPresent ? (ecMatch ? ecMatch[1].toLowerCase() : null) : null
  push('E5',
    editorconfigPresent && attrPresent && !!attrDeclares && !!ecDeclares && attrDeclares === ecDeclares,
    `尺⓪写侧声明：.gitattributes=${attrPresent ? (attrDeclares ?? '未声明 eol（只有 linguist 类规则）') : '文件不存在'}`
      + ` ⇄ .editorconfig=${editorconfigPresent ? (ecDeclares ?? '**没有 end_of_line 键**') : '文件不存在'}`
      + (!editorconfigPresent || !attrPresent || !attrDeclares || !ecDeclares
        ? ' ⇒ 至少一侧读不到声明，**不判"一致"**'
        : (attrDeclares === ecDeclares ? ' ⇒ 同向（编辑器与 git 往同一个方向写）' : ' ⇒ **矛盾**：两侧会把同一件写成不同行尾')),
    !editorconfigPresent || !attrPresent || !attrDeclares || !ecDeclares,
    false)

  push('E6', true,
    `尺③git 工作树行尾口径（advisory・**拦提交=否**）：${worktreeGitCrlf === null ? '取数失败（`git ls-files --eol` 没跑成）' : `w/crlf ${worktreeGitCrlf} 件`}`
      + `｜本机 core.autocrlf=${autocrlf || '(未设置)'}`
      + (worktreeGitCrlf > 0 ? ' —— 本机是 CRLF 检出机器：任何"把工作树归一成 LF"的动作都会让 status 报脏而 blob 未变' : ''),
    false, true)

  const failed = rows.filter((r) => r.ok === false && !r.unverified)
  const unver = rows.filter((r) => r.unverified && !r.advisory)
  const verdict = failed.length ? 'RED' : (unver.length ? 'UNVERIFIED' : 'GREEN')
  return { rows, verdict, rc: failed.length ? 1 : (unver.length ? 2 : 0) }
}

function worktreeStats() {
  const r = git(['ls-files', '-z'])
  if (r.status !== 0) return { crlf: 0, total: 0 }
  let crlf = 0
  let total = 0
  for (const path of r.stdout.toString('utf8').split('\0')) {
    if (!path) continue
    total += 1
    try {
      if (readFileSync(join(ROOT, path)).includes('\r\n')) crlf += 1
    } catch { /* 单件读不到不影响这条 advisory 行 */ }
  }
  return { crlf, total }
}

function worktreeGitEolCount() {
  // `git ls-files --eol -z` 的一条记录是 `i/… w/… attr/…\t<路径>\0`：**属性面在第一个 TAB 之前**，
  // 所以按 TAB 切只能切出「信息串 + 路径」两段（上一轮我切成三段 ⇒ 取错列，造出"仍为 1 件"的假 0）。
  const r = git(['ls-files', '--eol', '-z'])
  if (r.status !== 0) return null
  let crlf = 0
  for (const rec of r.stdout.toString('utf8').split('\0')) {
    if (!rec) continue
    const info = rec.split('\t')[0] || ''
    const w = info.split(' ').find((tok) => tok.startsWith('w/'))
    if (w === 'w/crlf' || w === 'w/mixed') crlf += 1
  }
  return crlf
}

function autocrlfValue() {
  const r = git(['config', '--get', 'core.autocrlf'])
  return r.status === 0 ? r.stdout.toString('utf8').trim() : ''
}

function selftest() {
  const mk = (paths, binarySet, crlfSet = new Set()) => paths.map((p) => ({
    path: p, binary: binarySet.has(p), iEol: binarySet.has(p) ? 'i/-text' : (crlfSet.has(p) ? 'i/crlf' : 'i/lf'),
  }))
  const ATTR_OK = '* text=auto eol=lf\n*.webp binary\n'
  // E5 的两侧声明：默认给"同向的一份"，好让其余用例的 want/got 只归因到自己那条腿。
  const EC_OK = 'root = true\n[*]\nend_of_line = lf\n'
  const ec = (text = EC_OK, present = true) => ({ editorconfigText: text, editorconfigPresent: present })
  const blobsOf = (obj) => new Map(Object.entries(obj))
  const cases = []
  const add = (name, want, got) => cases.push({ name, want, got, ok: want === got })

  const clean = evaluate({ attrText: ATTR_OK, attrPresent: true, ...ec(),
    entries: mk(['a.js', 'b.webp'], new Set(['b.webp'])), blobs: blobsOf({ 'a.js': Buffer.from('x\n') }) })
  add('正例：文本 blob 全 LF + 二进制在册 ⇒ GREEN', 'GREEN', clean.verdict)

  const dirty = evaluate({ attrText: ATTR_OK, attrPresent: true, ...ec(),
    entries: mk(['a.js', 'b.webp'], new Set(['b.webp'])), blobs: blobsOf({ 'a.js': Buffer.from('x\r\n') }) })
  add('漏报侧：文本 blob 带 CRLF ⇒ RED', 'RED', dirty.verdict)

  const noAttr = evaluate({ attrText: '', attrPresent: false, ...ec(),
    entries: mk(['a.js'], new Set()), blobs: blobsOf({ 'a.js': Buffer.from('x\n') }) })
  add('边界：属性表不存在 ⇒ UNVERIFIED（不得读成"没有规则也没事"）', 'UNVERIFIED', noAttr.verdict)

  const unruled = evaluate({ attrText: ATTR_OK, attrPresent: true, ...ec(),
    entries: mk(['a.js', 'c.png'], new Set(['c.png'])), blobs: blobsOf({ 'a.js': Buffer.from('x\n') }) })
  add('漏报侧：git 判成二进制但名单里没有 .png ⇒ RED', 'RED', unruled.verdict)

  const halfRead = evaluate({ attrText: ATTR_OK, attrPresent: true, ...ec(),
    entries: mk(['a.js', 'b.js'], new Set()), blobs: blobsOf({ 'a.js': Buffer.from('x\n') }) })
  add('边界：一件 blob 没取到 ⇒ UNVERIFIED，不得凭"另一件干净"判 GREEN', 'UNVERIFIED', halfRead.verdict)

  const empty = evaluate({ attrText: ATTR_OK, attrPresent: true, ...ec(), entries: [], blobs: new Map() })
  add('零分母：一个跟踪件都没有 ⇒ 不许 PASS（E3 恒等式先塌）', 'RED', empty.verdict)

  // —— E5（写侧声明同向）三条：误报侧 / 漏报侧 / 零输入侧，缺一即这条腿没被测到。
  const conflict = evaluate({ attrText: ATTR_OK, attrPresent: true, entries: mk(['a.js'], new Set()),
    blobs: blobsOf({ 'a.js': Buffer.from('x\n') }), ...ec('root = true\n[*]\nend_of_line = crlf\n') })
  add('漏报侧：.gitattributes 说 lf 而 .editorconfig 说 crlf ⇒ RED（两侧会把同一件写成不同行尾）', 'RED', conflict.verdict)

  const noEcFile = evaluate({ attrText: ATTR_OK, attrPresent: true, entries: mk(['a.js'], new Set()),
    blobs: blobsOf({ 'a.js': Buffer.from('x\n') }), ...ec('', false) })
  add('零输入：.editorconfig 不存在 ⇒ UNVERIFIED（读不到声明不得判"一致"）', 'UNVERIFIED', noEcFile.verdict)

  const noKey = evaluate({ attrText: ATTR_OK, attrPresent: true, entries: mk(['a.js'], new Set()),
    blobs: blobsOf({ 'a.js': Buffer.from('x\n') }), ...ec('root = true\n[*]\ncharset = utf-8\n') })
  add('边界：文件在但没有 end_of_line 键 ⇒ UNVERIFIED（缺席的键不算矛盾、算没读到）', 'UNVERIFIED', noKey.verdict)

  // 变异体：把 E5 的判据摘掉（恒 ok=true）必须让"矛盾"那条腿翻绿 ⇒ 证明这条腿真的有牙齿。
  const mutated = evaluate({ attrText: ATTR_OK, attrPresent: true, entries: mk(['a.js'], new Set()),
    blobs: blobsOf({ 'a.js': Buffer.from('x\n') }), ...ec('root = true\n[*]\nend_of_line = crlf\n') })
  const e5 = mutated.rows.find((r) => r.id === 'E5')
  add('变异体面：E5 在矛盾输入上必须是 ok=false（若哪天被改成恒 ok，此断言即红）', false, !!e5 && e5.ok)

  for (const c of cases) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name} [want=${c.want} got=${c.got}]`)
  const bad = cases.filter((c) => !c.ok).length
  console.log(`[GATE:${bad ? 'eol-selftest-fail' : 'eol-selftest-pass'}] ${cases.length - bad}/${cases.length}`)
  return bad ? 1 : 0
}

function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const present = existsSync(join(ROOT, ATTR))
  const attrText = present ? readFileSync(join(ROOT, ATTR), 'utf8') : ''
  const entries = classified()
  if (!entries) {
    console.log('[verify:eol] UNVERIFIED `git ls-files -t` 没跑起来（rc!=0）⇒ 属性解析结果取不到，不据它下结论')
    return 2
  }
  if (!entries.length) {
    console.log('[verify:eol] UNVERIFIED 跟踪清单为空 ⇒ 没有对象可判（空集 ≠ 干净）')
    return 2
  }
  const { map: blobs, failures } = blobBytes(entries)
  const wt = worktreeStats()
  const ecPresent = existsSync(join(ROOT, '.editorconfig'))
  const ecText = ecPresent ? readFileSync(join(ROOT, '.editorconfig'), 'utf8') : ''
  const out = evaluate({ attrText, attrPresent: present, entries,
    blobs: blobs || new Map(), blobFailures: failures, worktreeCrlf: wt.crlf, worktreeTotal: wt.total,
    worktreeGitCrlf: worktreeGitEolCount(), autocrlf: autocrlfValue(),
    editorconfigText: ecText, editorconfigPresent: ecPresent })
  for (const r of out.rows) {
    console.log(`${r.unverified ? 'UNVERIFIED' : (r.ok ? 'PASS  ' : 'FAIL  ')} ${r.id} :: ${r.detail}`)
  }
  const texts = entries.filter((e) => !e.binary).length
  const blocking = out.rows.filter((r) => !r.advisory).map((r) => r.id).join(',')
  const reportOnly = out.rows.filter((r) => r.advisory).map((r) => r.id).join(',')
  console.log(`[verify:eol] verdict=${out.verdict} rc=${out.rc}｜跟踪 ${entries.length}（文本 ${texts} / 二进制 ${entries.length - texts}）`
    + `｜检查 ${out.rows.length}/${out.rows.length}｜拦提交=${blocking}｜只报不拦=${reportOnly}`)
  return out.rc
}

// 入口守卫按本仓既有写法（`resolve(argv[1]) === resolve(ROOT/scripts/SELF)`）：
// `import.meta.url === 'file://' + argv[1]` 在 Windows 上**永远不成立**（盘符/斜杠/百分号编码都不同），
// 那样写会让整脚本变成"跑了、退出码 0、什么都没判"的假通过 —— 本轮第一次就踩到了这个形状。
if (process.argv[1] && resolve(process.argv[1]) === resolve(join(ROOT, 'scripts', 'check-eol-purity.mjs'))) {
  process.exit(main())
}
