// WASM 产物的三方一致判据：盘上文件 ⇄ public/wasm/manifest.json ⇄ 源码里的 ABI 版本与 crate 源码。
//
// 拦的是「入库产物烂掉」这一类：改了 Rust 源码却忘记重编（sha 变不了）、
// 手改了 wasm 二进制、ABI 升版没同步 loader、产物漏进了 dist 却没进 public。
//
// 用法：node rust/scripts/check-wasm-artifact.mjs

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const dir = path.join(repoRoot, 'public', 'wasm')
const problems = []
const ok = (m) => console.log('  PASS ' + m)
const bad = (m) => { problems.push(m); console.log('  FAIL ' + m) }

const manifestPath = path.join(dir, 'manifest.json')
if (!existsSync(manifestPath)) {
  bad('缺 public/wasm/manifest.json ⇒ 跑 node rust/scripts/build-wasm.mjs')
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const file = path.join(dir, manifest.file)
  if (!existsSync(file)) {
    bad('清单点了 ' + manifest.file + '，但盘上没有')
  } else {
    const bytes = readFileSync(file)
    const sha = createHash('sha256').update(bytes).digest('hex')
    if (sha !== manifest.sha256) bad('产物 sha256 与 manifest 不符（二进制被替换或源码改了没重编）')
    else ok('产物 sha256 与 manifest 一致（' + bytes.length + ' B）')
    if (bytes.length !== manifest.bytes) bad('产物体积与 manifest 不符')
    // wasm 魔数：不是 wasm 的东西不许冒充产物
    if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      bad('产物不是 WebAssembly 二进制（缺 \0asm 魔数）')
    } else ok('产物是合法 wasm（\0asm 魔数在场）')
    if (manifest.optimized !== true) ok('manifest 标注未过 wasm-opt（体积约 +18%，可接受但要知道）')
  }
  // ABI 三方：crate 源码 ⇄ manifest ⇄ loader 胶水
  const libSrc = readFileSync(path.join(rustRoot, 'crates', 'wasm', 'src', 'lib.rs'), 'utf8')
  const crateAbi = Number((libSrc.match(/SM_ABI_VERSION:\s*i32\s*=\s*(\d+)/) || [])[1] || 0)
  const loaderSrc = readFileSync(path.join(rustRoot, 'web', 'wasm-loader.js'), 'utf8')
  const loaderAbi = Number((loaderSrc.match(/SM_ABI_VERSION\s*=\s*(\d+)/) || [])[1] || 0)
  if (!crateAbi || !loaderAbi) bad('读不到 ABI 版本（crate=' + crateAbi + '，loader=' + loaderAbi + '）')
  else if (crateAbi !== loaderAbi) bad('ABI 版本不一致：crate=' + crateAbi + ' loader=' + loaderAbi)
  else if (crateAbi !== manifest.abiVersion) bad('manifest 的 ABI 版本过期：manifest=' + manifest.abiVersion + ' 源码=' + crateAbi)
  else ok('ABI 版本三方一致（v' + crateAbi + '）')
  const crateSha = createHash('sha256').update(libSrc).digest('hex')
  if (manifest.sourceCrateSha256 && manifest.sourceCrateSha256 !== crateSha) {
    bad('crates/wasm/src/lib.rs 在产物生成之后被改过 ⇒ 需要重跑 build-wasm')
  } else ok('产物对应的 crate 源码未漂移')
}

console.log(problems.length ? '\nGATE-FAIL check-wasm-artifact：' + problems.length + ' 项' : '\nGATE-PASS check-wasm-artifact：全部通过')
process.exit(problems.length ? 1 : 0)
