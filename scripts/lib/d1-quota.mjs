// D1 配额口径的唯一源（第四十二轮 R42-H1/H2 将本模块下沉）。
//
// 为什么新建这一份而不是继续从 check-d1-roundtrips.mjs 直接 import：
// 本文件有 2 个消费者（check-d1-roundtrips.mjs 与 check-d1-remote-usage.mjs），共享同 4 个配额常量。
// 直接 import 消费方的话，新消费者在 requireInputs 门口之前就会被另一判据的诊断抢先（实测：
// 在只拷 scripts/ 的骨架里跑 check-d1-remote-usage，第一行印的是 [d1-roundtrip] 的环境不满足而不是自己的），
// 虽然最终 rc 正确，但"该补什么"这句话指错了脚本 —— 这正是第二十五轮立"首行必须是自家诊断"的初衷。
//
// 下沉到 lib/ 叶子模块后：
//   ① 两个消费者各打各的 requireInputs，首行诊断正确；
//   ② 配额值仍然单源（lib/d1-quota.mjs 这一份），不因为解耦而多抄；
//   ③ check-limit-provenance.mjs 的 PLATFORM_FACTS 对账不受影响（它扫 functions/ 与 src/，不扫 lib/）。
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(libDir, '../..')

// ── D1 官方每日配额（免费档；出处 = docs/limit-provenance.md 的 PLATFORM_FACTS）──
/** 每日行写入免费档（cloudflare/cloudflare-docs src/content/partials/workers/d1-pricing.mdx:7-8 本机现取 @2026-09-28T01:41:11Z） */
export const DAILY_ROWS_WRITTEN_FREE = 100_000
/** 每日行读取免费档（同文件 :7） */
export const DAILY_ROWS_READ_FREE = 5_000_000
/** 强制执行口径（自 2026-09-01，超限查询直接失败：src/content/changelog/d1/2026-09-01-d1-free-tier-limit-enforcement.mdx:9） */
export const ENFORCEMENT_SINCE = '2026-09-01'

// ── 登记册与回执的文件路径（产物写入的两条链）──
export const WRITE_QUOTA_FILE = join(root, 'docs', 'd1-write-quota.json')
export const REMOTE_USAGE_FILE = join(root, 'docs', 'd1-remote-usage.json')

/** 本机测不到的那半（node:sqlite 只给 changes=受影响行数，扫描行数拿不到 ⇒ 远端读数唯一靠回执） */
export const ROWS_READ_MEASURABLE_LOCALLY = false

/** 回执新鲜度上限（天）：远端读数会过期，过期的 VERIFIED 等于没取到。 */
export const REMOTE_MAX_AGE_DAYS = 7

/**
 * 从回执对象推导"应当声明什么"（状态，不带时刻 —— 时刻进登记册会让 A11/U7 变永红，本轮实测过）。
 * 只认通道状态（VERIFIED/UNREACHABLE），不认整体 verdict（RED 里可能包含"登记册落后"这一条，
 * 拿它当依据会形成循环依赖：登记册等回执不红、回执等登记册更新）。
 * @returns {{claim:'VERIFIED'|'UNVERIFIED', at:string|null, why:string}}
 */
export function remoteUsageClaim(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return { claim: 'UNVERIFIED', at: null, why: '远端用量回执没落盘（跑 `npm run report:d1-usage -- --write`）⇒ 记未验证而不是通过' }
  }
  const ch = receipt.channels || {}
  const got = Object.entries(ch).filter(([, v]) => v && v.state === 'VERIFIED').map(([k]) => k)
  if (!got.length) {
    return { claim: 'UNVERIFIED', at: null, why: `回执里 ${Object.keys(ch).length} 条通道全部未取到读数（原因见回执）⇒ 记未验证而不是通过` }
  }
  return {
    claim: 'VERIFIED',
    at: receipt.retrievedAtUtc || null,
    why: `回执 ${got.join('+')} 通道取到读数 @${receipt.retrievedAtUtc}（窗口 ${receipt.windowUtc?.today_geq} .. ${receipt.windowUtc?.today_lt}，按 00:00 UTC 日界）`,
  }
}
