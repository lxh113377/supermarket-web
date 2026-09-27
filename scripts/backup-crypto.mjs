#!/usr/bin/env node
/**
 * backup-crypto —— 备份产物的"先加密再上传"通道（第三十七轮 R37-H1）。
 *
 * 为什么要有第三条出路（一手事实，不是假想）：
 * - `actions/upload-artifact` README:123 原文：artifact 下载 URL "**Users must be logged-in in order for
 *   this URL to work**" —— 只要求**已登录**，不要求是本仓成员。本仓 2026-09-25 起是 **public**，
 *   于是"全库明文导出物进 artifact"= 任意登录 GitHub 用户可下载顾客手机号/订单数据。
 * - 现有守卫因此直接拒绝非 private 仓落明文产物 ⇒ 结果是**备份整条链一件都没发生**（R36 实测 4/4 零产物）。
 * - 出路只有三条：转回 private（用户侧）/ 换存储（用户侧）/ **先加密再上传**（本模块，代码侧可做）。
 *
 * 设计口径（借 `FiloSottile/age` 的 passphrase 模式：口令是唯一需要交给人配置的 secret，
 * 密文自带格式、解密时自动识别 —— README:174/182/256）：
 * - AES-256-GCM（认证加密：篡改/口令错都会当场失败，不会解出一份"看起来对"的库）；
 * - 密钥派生 scrypt，参数**写死并前置在头里**（N=2^15, r=8, p=1，32B 输出）。为什么不抄 age 的
 *   N=2^18, r=8, p=1：CI runner 与本机免费档内存预算下 2^18 会让解密在低配机器上直接 OOM，
 *   而备份解密是"事故时要能跑通"的路径 —— 取舍写在这里，不留"为什么这么小"的悬案；
 * - 容器格式定长头，便于流式校验与"截断即拒"：
 *     magic 'SMBK'(4B) | version(1B=0x01) | salt(16B) | iv(12B) | tag(16B) | ciphertext(剩余)
 * - **口令只从环境变量读**（argv 传口令会进 ps/日志/shell 历史）。
 *
 * 用法：
 *   node scripts/backup-crypto.mjs --encrypt <in> <out>     # BACKUP_PASSPHRASE 必填
 *   node scripts/backup-crypto.mjs --verify <plain> <in>    # 解回并与原文逐字节比对（备份链的往返自证）
 *   node scripts/backup-crypto.mjs --decrypt <in> [<out>]   # 同上；缺省出到 stdout
 *   node scripts/backup-crypto.mjs --inspect <file>         # 只看头（口令不参与）
 * 退出码：0=成功 / 1=口令错、数据被篡改或往返不等（GCM 校验失败、格式不合法）/ 2=输入面不满足（缺文件、缺口令、缺参数）
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const MAGIC = 'SMBK'
export const VERSION = 1
export const SALT_LEN = 16
export const IV_LEN = 12
export const TAG_LEN = 16
export const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN // 49
export const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
export const PASSPHRASE_ENV = 'BACKUP_PASSPHRASE'

/** 口令 → 32B 密钥。scrypt 参数固定，故同一 (口令, salt) 恒得同一把钥匙（salt 每次随机 ⇒ 同文件两次加密密文不同）。 */
export function deriveKey(passphrase, salt) {
  return scryptSync(Buffer.from(String(passphrase), 'utf8'), salt, 32, SCRYPT_PARAMS)
}

/** 明文 Buffer + 口令 → 容器 Buffer。口令空/非字符串、明文空 ⇒ 抛（不产出"看着像密文其实是空"的文件）。 */
export function encryptBuffer(plain, passphrase) {
  const pw = String(passphrase ?? '')
  if (!pw) throw new Error('口令为空 ⇒ 拒绝加密（空口令等于没加密，且会把"忘了配 secret"伪装成备份成功）')
  const buf = Buffer.isBuffer(plain) ? plain : Buffer.from(plain)
  if (!buf.length) throw new Error('待加密内容为空 ⇒ 拒绝产出 0 字节"密文"')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const c = createCipheriv('aes-256-gcm', deriveKey(pw, salt), iv)
  const body = Buffer.concat([c.update(buf), c.final()])
  const tag = c.getAuthTag()
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), Buffer.from([VERSION]), salt, iv, tag, body])
}

/** 容器解析（不校验口令）：格式不合法即抛，且把"为什么"说清楚。 */
export function parseContainer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_LEN) {
    throw new Error(`容器短于定长头 ${HEADER_LEN}B（实际 ${buf ? buf.length : 0}B）⇒ 截断或根本不是备份密文`)
  }
  const magic = buf.subarray(0, MAGIC.length).toString('ascii')
  if (magic !== MAGIC) throw new Error(`magic 不符（读到 "${magic}"，应为 "${MAGIC}"）⇒ 不是本工具产出的密文`)
  const version = buf[MAGIC.length]
  if (version !== VERSION) throw new Error(`容器版本 ${version} 未支持（本工具写 ${VERSION}）⇒ 先升工具再解旧档，禁静默兼容`)
  return {
    version,
    salt: buf.subarray(5, 5 + SALT_LEN),
    iv: buf.subarray(5 + SALT_LEN, 5 + SALT_LEN + IV_LEN),
    tag: buf.subarray(5 + SALT_LEN + IV_LEN, HEADER_LEN),
    ct: buf.subarray(HEADER_LEN),
  }
}

/** 容器 + 口令 → 明文 Buffer。口令错/被篡改 ⇒ 抛（GCM tag 是判据，不吞）。 */
export function decryptBuffer(container, passphrase) {
  const pw = String(passphrase ?? '')
  if (!pw) throw new Error(`口令为空 ⇒ 拒绝解密（环境变量 ${PASSPHRASE_ENV} 未配？）`)
  const { salt, iv, tag, ct } = parseContainer(container)
  const d = createDecipheriv('aes-256-gcm', deriveKey(pw, salt), iv)
  d.setAuthTag(tag)
  try {
    return Buffer.concat([d.update(ct), d.final()])
  } catch (e) {
    throw new Error(`GCM 校验失败 ⇒ 口令不对或文件被篡改（${e.message}）。宁可红，不许交出一份解开的脏数据`)
  }
}

/** 只读头：用于"产物是密文还是明文"这类判定，不需要口令。 */
export function inspect(container) {
  try {
    const p = parseContainer(container)
    return { encrypted: true, version: p.version, cipherBytes: p.ct.length, plainAtMost: Math.max(0, p.ct.length) }
  } catch (e) {
    return { encrypted: false, why: e.message }
  }
}

export function main({ argv = [] } = {}) {
  const mode = argv.find((a) => /^--(encrypt|decrypt|inspect|verify)$/.test(a))
  const pos = argv.filter((a) => !a.startsWith('--'))
  if (!mode) { console.error('缺模式参数（--encrypt|--decrypt|--inspect|--verify）'); return 2 }
  // 未知 flag 一律拒，不当位置参数吞掉：吞了就会让 `--decrypt x --passphrase 口令` 这条路"看起来能用"，
  // 而口令进 argv = 进 ps 与 CI 日志；静默忽略更糟（用户以为传成功了）。
  const unknown = argv.filter((a) => a.startsWith('--') && a !== mode)
  if (unknown.length) { console.error(`未知参数：${unknown.join(' ')} ⇒ 拒（口令只能走 ${PASSPHRASE_ENV} 环境变量）`); return 2 }
  const need = mode === '--inspect' ? 1 : mode === '--verify' ? 2 : 1
  if (pos.length < need) { console.error(`${mode} 需要 ${need} 个路径参数（得到 ${pos.length} 个）`); return 2 }
  const src = resolve(pos[0])
  if (!existsSync(src) || !statSync(src).isFile()) bail('backup-crypto', `取不到输入文件 ${src}`)
  const data = readFileSync(src)
  const pw = process.env[PASSPHRASE_ENV] || ''
  try {
    if (mode === '--verify') {
      // 备份只有在"被载回并逐字节比对过"之后才算备份：口令错、容器截断、头被改都在这一步现形。
      if (!pw) { console.error(`[backup-crypto] ${PASSPHRASE_ENV} 未配 ⇒ 无法验证解密（这是未验证，不是通过）`); return 2 }
      const cnr = readFileSync(resolve(pos[1]))
      const plain = decryptBuffer(cnr, pw)
      if (!plain.equals(data)) {
        console.error(`[backup-crypto] FAIL 解密结果与原文逐字节不等（原文 ${data.length}B vs 解出 ${plain.length}B）⇒ 这份产物不能当备份`)
        return 1
      }
      console.log(`[backup-crypto] OK 往返自证：${data.length}B 明文 → ${cnr.length}B 容器 → 解回逐字节相等`)
      return 0
    }
    if (mode === '--encrypt') {
      if (!pw) { console.error(`[backup-crypto] ${PASSPHRASE_ENV} 未配 ⇒ 拒（把"忘配 secret"响亮报红，不产明文）`); return 2 }
      writeFileSync(resolve(pos[1]), encryptBuffer(data, pw))
      console.log(`[backup-crypto] OK 加密 ${data.length}B → ${statSync(resolve(pos[1])).size}B（AES-256-GCM/scrypt N=${SCRYPT_PARAMS.N}）`)
      return 0
    }
    if (mode === '--inspect') {
      const i = inspect(data)
      console.log(`[backup-crypto] ${i.encrypted ? `密文 v${i.version}，密文体 ${i.cipherBytes}B` : `非本工具密文：${i.why}`}`)
      return i.encrypted ? 0 : 1
    }
    if (!pw) { console.error(`[backup-crypto] ${PASSPHRASE_ENV} 未配 ⇒ 拒（口令一律走 env，禁命令行传参）`); return 2 }
    const plain = decryptBuffer(data, pw)
    if (pos[1]) { writeFileSync(resolve(pos[1]), plain); console.log(`[backup-crypto] OK 解密 ${data.length}B → ${pos[1]}（${plain.length}B）`) }
    else process.stdout.write(plain)
    return 0
  } catch (e) {
    console.error(`[backup-crypto] FAIL ${mode} ${src} :: ${e.message}`)
    return 1
  }
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main({ argv: process.argv.slice(2) }))
export { root as REPO_ROOT }
