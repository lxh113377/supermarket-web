// 两侧同值必须被机器钉住：服务端 functions/lib/actions/products.js 的 BATCH_UPDATE_MAX
// 与前端 src/auth.ts 的 BATCH_UPDATE_CHUNK 是**两条构建链上的两份字面量**
// （Pages Functions 与 Vite 前端无法共享模块，同 src/utils/spec-options.ts 的口味分隔符先例）。
// 漂移的后果不是报错而是"前端一次发 200 条 ⇒ 后端整批拒绝"，用户看到的就是"多选改价突然不能用了"。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const server = readFileSync('functions/lib/actions/products.js', 'utf8').replace(/\r\n/g, '\n')
const client = readFileSync('src/auth.ts', 'utf8').replace(/\r\n/g, '\n')

const num = (re: RegExp, src: string, what: string) => {
  const m = re.exec(src)
  expect(m, `没解析到 ${what} —— 常量改名/换写法会让本契约静默失效，必须判红`).toBeTruthy()
  return Number(m![1])
}

describe('批量分片两侧契约', () => {
  const max = num(/export const BATCH_UPDATE_MAX = (\d+)/, server, '服务端 BATCH_UPDATE_MAX')
  const chunk = num(/export const BATCH_UPDATE_CHUNK = (\d+)/, client, '前端 BATCH_UPDATE_CHUNK')

  it('前端分片 == 服务端上限（等号，不是 <=：小了白拆、大了必被拒）', () => {
    expect(chunk).toBe(max)
  })

  it('服务端上限确实从平台预算推导：40 < D1 免费档每调用 50 查询', () => {
    // 本 action 语句数 = 1 + n ⇒ 41 条 < 50，留 9 条给鉴权/限流/审计写入
    expect(max + 1).toBeLessThan(50)
    expect(max).toBeGreaterThan(0)
  })

  it('删除件的上限不跟着一起改（它受的是另一个预算）', () => {
    const del = num(/export const BATCH_DELETE_MAX = (\d+)/, server, 'BATCH_DELETE_MAX')
    expect(del).toBe(200)
    // 那边 1 条语句带 del 个绑定参数，SQLite 999 上限 ⇒ 仍安全；若有人把它改成 40 是误伤
    expect(del).toBeLessThan(999)
  })

  it('拒绝消息带具体数字，不写死「200」这句旧文案', () => {
    expect(server).toContain('单次批量最多 ${BATCH_UPDATE_MAX} 个商品')
    expect(server).not.toMatch(/单次批量最多 200 个商品/)
  })
})
