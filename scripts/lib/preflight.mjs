// 缺输入面的统一收口（第二十五轮）。
//
// 动因是实测，不是假想：把 22 个"门禁类入口"（npm 别名 verify:*/check:*）逐条拷进一个
// **只有 scripts/ 的空目录**里跑，结果 8 个直接甩 ENOENT/MODULE_NOT_FOUND 栈、
// 1 个连 package.json 都没有却打印「0 个生产依赖（含传递）全部 MIT/BSD/Apache/ISC 类白名单 ✅」
// 然后 exit 0。前者把环境问题伪装成代码崩溃（CI 里没人能从 `node:fs:441` 读出该补什么），
// 后者把"什么都没扫到"读成"扫过且清白" —— 那正是本项目第十八~二十一轮"CI 全绿"假账的机制。
//
// 口径沿用本仓既有判据的文案（`[env-docs] 代码源目录缺失：functions/ —— 取不到真值集就不判"通过"`、
// `[doc-consistency] 环境不满足：…`），退出码取 2 = "环境不满足"，与 1 = "判出违规"分开。
import { existsSync, readFileSync } from 'node:fs'

/** 唯一的"环境不满足"出口：一条人话 + rc=2。第二十六轮把形状收成一个（见 R25-M4）。 */
export function bail(label, reason) {
  console.error(`[${label}] 环境不满足：${reason} ⇒ 没有对象就无法判"通过"，fail-closed 退出（rc=2）`)
  process.exit(2)
}

/**
 * @param {string} label 判据前缀。探针断言"输出首行是自家诊断而不是 node: 栈帧"，所以 label 必须真打印出来。
 * @param {string[]} paths 必须存在的路径（文件或目录），空值会被忽略以免把拼错的路径算成缺失。
 */
export function requireInputs(label, paths) {
  const missing = (paths || []).filter((p) => p && !existsSync(p))
  if (!missing.length) return
  bail(label, `取不到 ${missing.join(' , ')}`)
}

/** 缺必需参数（env / CLI flag）走同一条出口 —— 否则"缺输入"在日志里会有第二种长相。 */
export function requireParams(label, names) {
  const missing = (names || []).filter((n) => !String(process.env[n] || '').trim())
  if (!missing.length) return
  bail(label, `缺少参数 ${missing.join(' , ')}（由调用方显式给出，判据不猜默认值）`)
}

/**
 * JSON 输入必须**解析得动**才算"输入面存在"。第二十六轮零分母普查实测：损坏/0 字节的 package.json
 * 会让 Node 在解析任何仓库内模块前先崩在 `package_json_reader`（裸栈），判据的 fail-closed 文案根本没机会印；
 * 而"0 通过 / 0 失败"这类结论又是另一条路把空集读成绿。两种都要在门口拦住。
 */
export function requireJson(label, paths) {
  const broken = []
  for (const p of (paths || []).filter(Boolean)) {   // 刻意允许传 null："这一项本次不需要"（如 --write 时基准文件还没生成）
    if (!existsSync(p)) { broken.push(`${p}（不存在）`); continue }
    try {
      const t = readFileSync(p, 'utf8').trim()
      if (!t) { broken.push(`${p}（空文件）`); continue }
      JSON.parse(t)
    } catch { broken.push(`${p}（不是合法 JSON）`) }
  }
  if (!broken.length) return
  bail(label, `JSON 输入不可解析：${broken.join(' , ')}`)
}


