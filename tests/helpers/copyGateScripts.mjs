// 测试夹具用：把真仓的门禁脚本拷进夹具仓，并**从脚本自己的源码里**解析出 `./lib/**`、`./helpers/**`
// 共用依赖一起拷（第二十六轮：门禁开始共用 `scripts/lib/preflight.mjs`，只拷单文件的夹具会以
// ERR_MODULE_NOT_FOUND 崩掉 —— 那测到的是"复制清单不全"，不是判据行为）。
//
// 为什么放在 helper 而不是各测试文件里各写一份：这段正则一旦有两份，就会有一份随重构过期，
// 于是"改共享件先枚举消费者"这条铁律又退化成靠人记。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DEP_RE = /from '\.\/((?:lib|helpers)\/[A-Za-z0-9._-]+\.mjs)'/g

/**
 * @param {string} repoRoot 真仓根（里面有 scripts/）
 * @param {string} destRoot 夹具仓根；脚本会落到 destRoot/scripts/
 * @param {string[]} names 要拷的脚本文件名（相对 scripts/）
 */
export function copyGateScripts(repoRoot, destRoot, ...names) {
  const local = join(destRoot, 'scripts')
  mkdirSync(local, { recursive: true })
  for (const n of names) {
    const src = readFileSync(join(repoRoot, 'scripts', n), 'utf8')
    writeFileSync(join(local, n), src)
    for (const m of src.matchAll(DEP_RE)) {
      mkdirSync(join(local, m[1].split('/')[0]), { recursive: true })
      writeFileSync(join(local, m[1]), readFileSync(join(repoRoot, 'scripts', m[1]), 'utf8'))
    }
  }
  return local
}
