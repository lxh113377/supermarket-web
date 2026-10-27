// 构建 WASM 加速器并落进前端可发布的目录（public/wasm/）。
//
// 为什么产物要**入库**（而不是 CI 里现场编译）：本仓的部署链是 Cloudflare Pages + GitHub Pages，
// 两者都不带 Rust 工具链；把「有没有 wasm」变成 CI 前置条件，等于给发布加一条全新的环境依赖。
// 折中（并有判据兜底）：产物入库 + 一份 manifest（sha256/size/ABI 版本/来源 crate 的 SHA256），
// 由 rust/scripts/check-wasm-artifact.mjs 判「盘上产物 ⇄ manifest ⇄ 源码里的 ABI 版本」三方一致 ——
// 源码改了却忘记重编，判据当场判红（那正是「入库产物」最容易烂掉的地方）。
//
// 用法：node rust/scripts/build-wasm.mjs [--no-opt] [--out public/wasm]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const args = process.argv.slice(2)
const outDir = path.resolve(args[args.indexOf('--out') + 1] && args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : path.join(repoRoot, 'public', 'wasm'))
const useOpt = !args.includes('--no-opt')

const cargo = process.env.CARGO || 'cargo'
const raw = path.join(rustRoot, 'target', 'wasm32-unknown-unknown', 'release-wasm', 'supermarket_wasm.wasm')
const opt = path.join(rustRoot, 'target', 'supermarket_wasm.opt.wasm')
const wasmOpt = process.env.WASM_OPT || 'wasm-opt'

const build = spawnSync(cargo, ['build', '-p', 'supermarket-wasm', '--profile', 'release-wasm', '--target', 'wasm32-unknown-unknown'], {
  cwd: rustRoot, encoding: 'utf8', shell: process.platform === 'win32',
})
if (build.status !== 0) {
  console.error('cargo build 失败：\n' + ((build.stdout || '') + (build.stderr || '')).slice(-1200))
  process.exit(2)
}
if (!existsSync(raw)) { console.error('找不到产物 ' + raw); process.exit(2) }

let source = raw
if (useOpt) {
  const res = spawnSync(wasmOpt, ['-Oz', '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '-o', opt, raw], {
    cwd: rustRoot, encoding: 'utf8', shell: process.platform === 'win32',
  })
  if (res.status === 0 && existsSync(opt)) {
    source = opt
  } else {
    // wasm-opt 不在盘上不该阻断构建：降级用 cargo 产物并**明说**（数字上差约 18%）
    console.warn('[build-wasm] wasm-opt 不可用，改用 cargo 产物（体积约 +18%）')
  }
}

mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, 'supermarket_wasm.wasm')
copyFileSync(source, target)
const bytes = readFileSync(target)
// 注意要 utf8：readFileSync 默认给 Buffer，Buffer 上没有 .match（第一版就这么栽的）
const libSrc = readFileSync(path.join(rustRoot, 'crates', 'wasm', 'src', 'lib.rs'), 'utf8')
const abi = (libSrc.match(/SM_ABI_VERSION:\s*i32\s*=\s*(\d+)/) || [])[1] || ''
const manifest = {
  file: 'supermarket_wasm.wasm',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  abiVersion: Number(abi),
  optimized: source === opt,
  sourceCrateSha256: createHash('sha256').update(libSrc).digest('hex'),
  generatedAt: new Date().toISOString(),
  note: '由 rust/scripts/build-wasm.mjs 生成；判据 = rust/scripts/check-wasm-artifact.mjs（盘上产物 ⇄ 本 manifest ⇄ 源码 ABI）',
}
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`已落 ${path.relative(repoRoot, target)}（${bytes.length} B / ${manifest.sha256.slice(0, 12)}… / ABI v${manifest.abiVersion} / optimized=${manifest.optimized}）`)
console.log('原始 cargo 产物 ' + statSync(raw).size + ' B' + (source === opt ? `，wasm-opt 后 ${statSync(opt).size} B` : ''))
