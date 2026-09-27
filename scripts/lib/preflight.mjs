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
import { existsSync } from 'node:fs'

/**
 * @param {string} label 判据前缀。探针断言"输出首行是自家诊断而不是 node: 栈帧"，所以 label 必须真打印出来。
 * @param {string[]} paths 必须存在的路径（文件或目录），空值会被忽略以免把拼错的路径算成缺失。
 */
export function requireInputs(label, paths) {
  const missing = (paths || []).filter((p) => p && !existsSync(p))
  if (!missing.length) return
  console.error(`[${label}] 环境不满足：取不到 ${missing.join(' , ')} ⇒ 没有对象就无法判"通过"，fail-closed 退出（rc=2）`)
  process.exit(2)
}
