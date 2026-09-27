// 计量版 D1 假实现（node:sqlite 之上，对齐 D1 Workers API 的 prepare/bind/all/first/run/batch）。
// 唯一数据源：scripts/verify-backend.mjs 与 scripts/check-d1-roundtrips.mjs 共用本件，
// 避免「mock 只会 prepare/run、真 D1 有 batch」两条链各说各话（batch 语义若只在测试里成立=假验证）。
//
// 两把尺，各自独立计数（第二把尺是第十四轮新增，第一把尺口径一字未动）：
//   statements —— prepare() 次数，即送进 D1 的 SQL 条数（对应 D1「Queries per Worker invocation」配额）
//   roundTrips —— 与 D1 的网络往返次数：all/first/run 各 1 次；batch(N 条) 合计 1 次
import { DatabaseSync } from 'node:sqlite'

export function openSqlite(scripts = []) {
  const db = new DatabaseSync(':memory:')
  for (const s of scripts) db.exec(s)
  return db
}

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * 按 action 归因 SQL 条数的**异步上下文**（第二十七轮）。
 *
 * 为什么不用"全局计数器在 action 边界做差"：那种口径假设一个 action 的所有语句都在它的 await 窗口内跑完，
 * 而 `functions/lib/backend.js` 里 `maybeNotifyNewOrder` 是**故意不 await** 的（通知再慢也不能延后顾客的
 * 下单响应）。于是同一次跑里多出来的那条语句会落进"下一个开始计数的 action"的窗口 ——
 * 实测：`A:createProduct` 峰值在未固定 `Math.random` 时 5 次跑出 4×2 + 1×3，固定种子后 6/6 恒为 3，
 * 而 createProduct 自身只发 1 条 INSERT ⇒ **抖的是归因，不是被测代码**。一条会随机变红的配额闸，
 * 比没有闸更让人学会忽略闸。
 */
export const sqlScope = new AsyncLocalStorage()

export function runInSqlScope(name, fn) {
  const store = { name, statements: 0, amortized: [] }
  return sqlScope.run(store, fn).then((r) => ({ result: r, statements: store.statements, amortized: store.amortized }))
}

/** 当前 action 上下文里已计到的语句数（无上下文时返回 null，调用方按旧口径兜底）。 */
export function currentScope() {
  return sqlScope.getStore() || null
}

/**
 * @param db  内存 SQLite
 * @param opts.classify  (sql) => 桶名 | null —— 把"摊销型后台清理"这类语句从当前 action 的计数里摘出去，
 *   单独记账。第二十八轮归因实证：`logSecurityEvent` 以 **5% 概率**顺带执行
 *   `DELETE FROM security_events WHERE ts < datetime('now','-90 days')`（Pages 无 cron，写时采样），
 *   于是这条语句被算到"恰好触发它的那个 action"头上 ⇒ 11/30 个 action 的语句峰值随机 +1、
 *   每轮换一个受害者。生产代码的摊销设计没变，错的是测量口径把它当成 action 自身的开销。
 */
export function createMeteredD1(db, { classify = null } = {}) {
  // 第三把尺 rowsWritten —— 平台侧 D1 免费档按「行写入」计**每日**配额：
  //   cloudflare/cloudflare-docs src/content/partials/workers/d1-pricing.mdx:8
  //     "| Rows written            | 100,000 / day ..."
  //   同文件 :18 给定义（INSERT/UPDATE/DELETE 都算，一次 INSERT 10 行 = 10 rows written）；
  //   同文件 :24 "Free limits reset daily at 00:00 UTC"；
  //   changelog/d1/2026-09-01-d1-free-tier-limit-enforcement.mdx:9 明写超限 "will fail"。
  //   引文均 @2026-09-28T01:41:11Z 本机 gh api contents 现取现验，不是转述。
  // 取 info.changes 与那句定义同一口径（它就是 SQLite 的受影响行数）。
  const counters = { statements: 0, roundTrips: 0, rowsWritten: 0, buckets: {} }
  const log = []
  // 归因实验（第二十八轮）：每条日志带上"发起它的 action"，用于把抖动的语句找出来。
  const stamp = (e) => { e.scope = sqlScope.getStore()?.name || null; log.push(e); return e }
  const coerce = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)

  // batch 成员专用：两个计数器都不动（prepare 已计 statements，整批只计 1 次 roundTrips）
  function runMember(member) {
    stamp({ sql: member.sql, kind: 'batch-member', params: member.params })
    const info = db.prepare(member.sql).run(...member.params.map(coerce))
    counters.rowsWritten += Number(info.changes) || 0
    return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } }
  }

  return {
    __counters: counters,
    __log: log,
    __sqlite: db,
    prepare(sql) {
      counters.statements += 1
      const bucket = classify ? classify(sql) : null
      const scope = sqlScope.getStore()
      if (bucket) {
        counters.buckets[bucket] = (counters.buckets[bucket] || 0) + 1
        if (scope) (scope.amortized = scope.amortized || []).push(bucket)
      } else if (scope) scope.statements += 1
      const member = { sql, params: [] }
      const api = {
        __member: member,
        bind(...params) {
          member.params = params
          return api
        },
        async all() {
          counters.roundTrips += 1
          stamp({ sql, kind: 'all', params: member.params })
          return { results: db.prepare(sql).all(...member.params.map(coerce)) }
        },
        async first() {
          counters.roundTrips += 1
          stamp({ sql, kind: 'first', params: member.params })
          const row = db.prepare(sql).get(...member.params.map(coerce))
          return row === undefined ? null : row
        },
        async run() {
          counters.roundTrips += 1
          stamp({ sql, kind: 'run', params: member.params })
          const info = db.prepare(sql).run(...member.params.map(coerce))
          counters.rowsWritten += Number(info.changes) || 0
          return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } }
        },
      }
      return api
    },
    // D1 batch 官方语义：多条语句一次送出、按给定顺序执行；
    // 任一条**执行失败** ⇒ 报错并回滚整个序列。
    // 关键边界：0 行变更不算失败 ⇒ guarded UPDATE 未命中不会触发回滚，
    // 所以「库存不足」仍必须走显式补偿（本判据 A5 就是钉这条边界）。
    async batch(list) {
      if (!Array.isArray(list)) throw new TypeError('D1 batch(): 参数必须是已 prepare 的语句数组')
      counters.roundTrips += 1
      stamp({ sql: `<<batch(${list.length})>>`, kind: 'batch', params: list.map((s) => s.__member.sql) })
      db.exec('BEGIN')
      try {
        const results = list.map((s) => runMember(s.__member))
        db.exec('COMMIT')
        return results
      } catch (e) {
        try { db.exec('ROLLBACK') } catch { /* 已回滚 */ }
        throw e
      }
    },
  }
}

export function resetCounters(d1) {
  d1.__counters.statements = 0
  d1.__counters.roundTrips = 0
  d1.__counters.rowsWritten = 0
  d1.__log.length = 0
}
