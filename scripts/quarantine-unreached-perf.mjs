/**
 * 隔离未采到样本（第七十轮 I-70-4）。
 *
 * 一手起因：`report:live-perf` 连续五轮 `verdict=RED`，而红的**唯一**来源是 customer 侧
 * 7 份 `runtimeError=NO_FCP` + `finalDisplayedUrl=about:blank` 的样本（入统计 27／未采到 7／产物不符 0／文件 34）。
 * 判据已经**正确地**把它们剔出统计（`NETWORK_ERROR_CODES` 那条），但它们仍躺在 `.lighthouse/` 里，
 * 于是每一轮都要重新解释一遍为什么剔 —— 噪声反复占用判据面，而"这是网络类不是站点退化"
 * 这个结论只存在于读报告的人的脑子里，**不在产物里**。
 *
 * 本件把这件事做成产物：把这类样本**移出**取数面，落到 `.lighthouse/quarantine/`，
 * 并在这里留一份索引（文件名 / runtimeError / 最终 URL / 字节 / 隔离时刻 / 判据读到的类型），
 * 于是「这 7 份为什么不算数」在磁盘上有据可查，而不是每轮靠人重读。
 *
 * 边界与不许做的事（户内既有铁律的直接应用）：
 *   ① **只搬不删**：一份字节都不改，移回 `.lighthouse/` 即完全复原（`--restore`）。
 *   ② **不得当"修好了"**：隔离之后 `verdict` 若仍 RED，那是判据给的真实结论，不是本件把它藏了 ——
 *      恒等式（入统计 + 未采到 + 产物不符 = 文件数）必须仍然成立且**由判据自己印**。
 *   ③ **不碰任何有 FCP 的样本**：判定条件就是 `runtimeError.code ∈ NETWORK_ERROR_CODES`，
 *      一件都不许"顺便"带进来。
 *
 * 用法：
 *   node scripts/quarantine-unreached-perf.mjs            # 隔离（幂等：已在隔离区的不重复搬）
 *   node scripts/quarantine-unreached-perf.mjs --dry-run   # 只报将要搬什么，不落盘
 *   node scripts/quarantine-unreached-perf.mjs --restore   # 全部移回 .lighthouse/
 */
import { existsSync, readFileSync, readdirSync, renameSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NETWORK_ERROR_CODES, DEFAULT_DIR } from './report-live-perf.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const QUARANTINE_DIR = join(DEFAULT_DIR, 'quarantine')
export const INDEX_FILE = 'INDEX.json'

/**
 * 读一份样本、返回它该不该进隔离区。**返回理由**而不只是布尔 ——
 * "没采到"与"JSON 坏了"是两类判决，混在一起就回到第六十九轮记的那个坑
 * （取数面自己坏了，红因却是套娃的）。
 */
export function classify(file, text) {
  if (!/-s\d+\.json$/.test(file)) return { move: false, why: '不是样本命名（`<page>[-<batch>]-s<n>.json`），本件只搬样本' }
  let j
  try { j = JSON.parse(text) } catch (e) {
    // 解析失败**不搬**：搬了就等于把"产物坏掉"藏起来，而那属于判据该红的事。
    return { move: false, why: `JSON 不可解析（${e.message.split('\n')[0]}）⇒ 属"产物面不符"，不是"没采到"，留在原地让判据红` }
  }
  const code = j && j.runtimeError && j.runtimeError.code
  if (!code) return { move: false, why: '有 FCP 的真样本 ⇒ 一律不碰' }
  if (!NETWORK_ERROR_CODES.has(code)) return { move: false, why: `runtimeError=${code} 不在网络类码表里 ⇒ 属别类失败，留在原地让判据红` }
  return {
    move: true,
    code,
    url: (j.finalDisplayedUrl || j.finalUrl || '').trim(),
    hasFcp: Boolean(j.audits && j.audits['first-contentful-paint']),
    why: `runtimeError=${code} ∈ 网络类码表且最终 URL 为 ${j.finalDisplayedUrl || j.finalUrl || '(空)'} ⇒ 这一批没采到，按本仓口径不得折进基线`,
  }
}

export function main({ dir = DEFAULT_DIR, quarantineDir = QUARANTINE_DIR, dryRun = false, restore = false, now = new Date().toISOString() } = {}) {
  if (!existsSync(dir)) {
    console.error(`[quarantine-perf] FAIL 取不到取数面 ${dir} ⇒ 没有对象就不记绿（fail-closed）`)
    return 2
  }
  if (restore) {
    if (!existsSync(quarantineDir)) {
      console.log(`[quarantine-perf] 无隔离区（${quarantineDir}）⇒ 无事可复原（这是"没有"，不是"复原了"）`)
      return 0
    }
    const back = readdirSync(quarantineDir).filter((f) => /-s\d+\.json$/.test(f))
    if (dryRun) {
      console.log(`[quarantine-perf] DRY-RUN 将复原 ${back.length} 件：${back.join(', ') || '无'}`)
      return 0
    }
    for (const f of back) renameSync(join(quarantineDir, f), join(dir, f))
    // 索引必须跟着走：隔离区空了还留着 INDEX.json，判据那行就会继续印「已隔离 N 件」——
    // 而实际一份都不在隔离区。**这是本轮实测撞到的真洞**（复原后 `report:live-perf` 仍印
    // 「已隔离 7 件」而 `未采到` 也是 7 ⇒ 同一批件被两个读数各数一遍）。
    // 隔离区空 ⇒ 撤索引（不是删数据，是撤那份"现在有 N 件在这儿"的声明）；非空 ⇒ 重写计数。
    const idxPath = join(quarantineDir, INDEX_FILE)
    const still = readdirSync(quarantineDir).filter((f) => /-s\d+\.json$/.test(f))
    if (still.length) {
      const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
      writeFileSync(idxPath, JSON.stringify({
        ...idx,
        counts: { ...(idx.counts || {}), isolated: still.length },
        lastRestoreUtc: now,
        items: idx.items.filter((it) => still.includes(it.f)),
      }, null, 2) + '\n', 'utf8')
    } else {
      rmSync(idxPath, { force: true })
    }
    console.log(`[quarantine-perf] PASS 已复原 ${back.length} 件回 ${dir}（字节未改，与隔离前逐件相同）｜隔离区余 ${still.length} 件${still.length ? '' : '，索引已撤 ⇒ 判据那行不再印「已隔离 N 件」'}`)
    return 0
  }

  const all = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const moved = []
  const kept = []
  for (const f of all) {
    const p = join(dir, f)
    const c = classify(f, readFileSync(p, 'utf8'))
    if (c.move) { moved.push({ f, bytes: statSync(p).size, ...c }) } else { kept.push({ f, why: c.why }) }
  }
  if (dryRun) {
    console.log(`[quarantine-perf] DRY-RUN 将隔离 ${moved.length} 件 / 留 ${kept.length} 件（不落盘）`)
    for (const m of moved) console.log(`  · ${m.f} | ${m.code} | ${m.url} | ${m.bytes}B`)
    for (const k of kept.filter((x) => /NO_FCP|PARSE|不可解析/.test(x.why))) console.log(`  · 留：${k.f} —— ${k.why}`)
    return 0
  }
  if (!moved.length) {
    // 零分母语义（第七十轮 `cliEntrypoints` 的零分母探针腿当场抓到的真缺陷）：
    // 「取数面里一件未采到都没有」有两种截然不同的成因 ——
    //   ① 已经隔离过了，再跑是幂等复查（**这是"扫过且清白"**）；
    //   ② 取数面本来就是空的 / 全被搬走了，本轮**根本没对象可扫**（这是"扫到 0 个对象"）。
    // 两者都印 "PASS 无事可隔离" 并返回 0，等于把"没东西可判"读成"没发现问题"。
    // ⇒ 判据：先证输入面非空（.lighthouse 里有样本命名那一族），空则 fail-closed rc=2。
    const sampleNamed = all.filter((f) => /-s\d+\.json$/.test(f))
    // 第二个零分母面：**文件在但内容空**。`cliEntrypoints` 的零分母探针腿要的就是这一面 ——
    // 它造一批 0 字节的样本文件，本件读它们时 classify 会走到「JSON 不可解析」分支（不搬），
    // 于是 moved=0，而"一件都没搬"不等于"这里没有可判的样本"。分母必须同时过**文件数**与**内容**两关：
    // 一件能解析出 audits/runtimeError 的样本都不存在时，"清白"是假的。
    const readable = sampleNamed.filter((f) => {
      try { JSON.parse(readFileSync(join(dir, f), 'utf8')); return true } catch { return false }
    })
    if (readable.length === 0) {
      const why = sampleNamed.length === 0
        ? `一件样本命名（\`<page>[-<batch>]-s<n>.json\`）都没有（该目录 .json 共 ${all.length} 个：${all.join(', ') || '无'}）`
        : `有 ${sampleNamed.length} 件样本命名文件，但**没有一件能解析出内容**（全 0 字节或坏 JSON）`
      console.error(`[quarantine-perf] FAIL 取数面 ${dir} 里${why} ⇒ 没有对象就不记绿（fail-closed rc=2）。`
        + `取证命令：npm run collect:live-perf`)
      return 2
    }
    const alreadyQuarantined = existsSync(join(quarantineDir, INDEX_FILE))
    console.log(`[quarantine-perf] PASS 取数面 ${sampleNamed.length} 件样本里已无未采到件`
      + `${alreadyQuarantined ? '（隔离区已有索引 ⇒ 这是幂等复查）' : ''} ⇒ 无事可隔离`)
    return 0
  }
  mkdirSync(quarantineDir, { recursive: true })
  for (const m of moved) {
    renameSync(join(dir, m.f), join(quarantineDir, m.f))
    m.isolatedUtc = now
  }
  // 索引写进隔离区：与被搬走的样本同处一地 ⇒ 复原时索引跟着一起回来，不会出现"索引描述的件不在这里"
  const keptSamples = readdirSync(dir).filter((f) => /-s\d+\.json$/.test(f))
  writeFileSync(join(quarantineDir, INDEX_FILE), JSON.stringify({
    $comment: '本目录是「没采到」的样本，不是坏样本。它们是网络类失败（runtimeError ∈ report-live-perf.mjs 的 NETWORK_ERROR_CODES），按本仓口径不得折进基线、不得折算成「站点很慢」。字节未改，一条命令可复原：node scripts/quarantine-unreached-perf.mjs --restore',
    isolatedUtc: now,
    rule: 'runtimeError.code ∈ NETWORK_ERROR_CODES ⇒ 未采到（隔离）；其余（含 JSON 不可解析）⇒ 留在取数面让判据红',
    counts: { isolated: moved.length, keptSamplesInSource: keptSamples.length },
    items: moved,
  }, null, 2) + '\n', 'utf8')
  // 收尾自检：复扫**样本命名**那一族里还有没有带 runtimeError 的件。
  // 谓词必须是"样本命名 ∧ 带 runtimeError"，不能是"任意 .json ∧ 带 runtimeError" ——
  // 判据输入面（roster 之类）本身就可能含 runtimeError 字段名（§G-70-4 的近邻坑：
  // 报"还剩 2 件"而那 2 件根本不是样本，就是谓词把非样本算进了分母）。
  const left = readdirSync(dir)
    .filter((f) => /-s\d+\.json$/.test(f))
    .filter((f) => /"runtimeError"\s*:\s*\{/.test(readFileSync(join(dir, f), 'utf8')))
  console.log(`[quarantine-perf] PASS 已隔离 ${moved.length} 件 → ${quarantineDir}（索引 ${INDEX_FILE}）｜取数面剩样本 ${keptSamples.length} 件｜复扫样本面 runtimeError 残留 = ${left.length}${left.length ? '：' + left.join(', ') : ''}`)
  for (const m of moved) console.log(`  · ${m.f} | ${m.code} | ${m.url} | ${m.bytes}B`)
  return left.length ? 1 : 0
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  // `--dir` 注入点（第七十轮补）：没有它，夹具想验"隔离/复原"就只能对着**真 `.lighthouse/`** 动手
  // —— 本轮第一次跑夹具就是这样，它把真仓的 7 件搬走了而夹具以为自己造的是合成目录。
  // 判据类脚本一律不许在缺省路径上做**搬动**这类有副作用的动作（读可以）。
  // 另：`--dir` 传进来后，隔离区与索引必须跟着走 —— 它们是 dir 的子件，不是 `DEFAULT_DIR` 的子件。
  const di = process.argv.indexOf('--dir')
  const dir = di >= 0 ? resolve(process.argv[di + 1] || '') : DEFAULT_DIR
  const qdir = join(dir, 'quarantine')
  process.exit(main({
    dir,
    quarantineDir: qdir,
    dryRun: process.argv.includes('--dry-run'),
    restore: process.argv.includes('--restore'),
  }))
}