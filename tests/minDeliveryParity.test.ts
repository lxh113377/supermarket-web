// 起送门槛两侧同值 + 文案单源的静态契约（2026-10-22 老大立规「购买物品总价低于六元不配送」）。
//
// 为什么值得单独一条判据（样板 = tests/limitCapParity.test.ts、tests/printCapParity.test.ts）：
// 两条构建链（Pages Functions 与 Vite 前端）物理上共享不了模块，所以这个 6 天然是双写；
// 而屏上那句「不满 ¥6.00 不配送」有六个触点（首页 / 购物车 / 确认页 / 商城吸底栏 / 详情页 / AI 助手），
// 服务端下单守卫是第七处 —— 任何一处自己写一个数字，改了另一处不会红，
// 症状正是本项目在册的那类「屏上指示与实际拒绝不一致」。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// 解析不到就必须判红：静默返回 NaN 的契约等于没有契约（同 limitCapParity 的口径）
const num = (re: RegExp, src: string, what: string) => {
  const m = re.exec(src)
  expect(m, `没解析到 ${what} ⇒ 本契约已随改名/换写法失效，必须修契约而不是放宽`).toBeTruthy()
  return Number(m![1])
}

describe('起送门槛两侧契约（MIN_DELIVERY_AMOUNT=6）', () => {
  const srvFile = read('functions/lib/shared.js')
  const cliFile = read('src/data/deliveryLimits.ts')
  const srv = num(/export const MIN_DELIVERY_AMOUNT = (\d+)/, srvFile, '服务端 MIN_DELIVERY_AMOUNT')
  const cli = num(/export const MIN_DELIVERY_AMOUNT = (\d+)/, cliFile, '前端 MIN_DELIVERY_AMOUNT')

  it('前端 == 服务端，且现值 == 6（两条构建链共享不了模块，靠这条钉住）', () => {
    expect(cli).toBe(srv)
    expect(srv).toBe(6)
  })

  it('服务端下单守卫真的引用常量（裸 < 6 = 第二真相源），且落在折前小计上', () => {
    const orders = read('functions/lib/actions/orders.js')
    expect(orders).toMatch(/if \(totalRounded < MIN_DELIVERY_AMOUNT\)/)
    expect(orders).toMatch(/fail\('below_min_delivery'/)
    expect(orders).not.toMatch(/totalRounded < 6\s*\)/)
    // 折前口径：门槛判断必须排在 bestPromotion（满减）之前
    expect(orders.indexOf('totalRounded < MIN_DELIVERY_AMOUNT'))
      .toBeLessThan(orders.indexOf('const promo = await bestPromotion'))
  })

  it('屏上触点全部引用常量而不是自己写数字', () => {
    for (const f of ['src/pages/HomePage.tsx', 'src/pages/CartPage.tsx', 'src/pages/OrderConfirmPage.tsx',
      'src/pages/CustomerPage.tsx', 'src/pages/ProductDetailPage.tsx',
      'src/components/product/ProductInfoSections.tsx', 'src/components/product/DemoOrderSummary.tsx',
      'src/data/services.ts']) {
      const src = read(f)
      expect(src, `${f} 未引用 deliveryLimits`).toContain('deliveryLimits')
      // 数字只准由常量渲染：屏上出现硬编码的「6 元 / ¥6.00 / 六元」即红
      expect(src, `${f} 出现硬编码的起送数字`).not.toMatch(/不满[^\n]{0,6}?(¥)?(6(\.00)?|六)\s*元/)
    }
  })

  it('AI 导购：服务端从常量渲染，「不满六元配送吗」命中门槛规则而不是泛泛的配送回答', async () => {
    const dify = read('functions/lib/dify.js')
    expect(dify).toContain("import { MIN_DELIVERY_AMOUNT } from './shared.js'")
    // 门槛规则必须排在配送规则之前，否则带「配送」二字的问句会被后者先命中
    const iGate = dify.indexOf("match: ['起送'")
    const iDeliver = dify.indexOf("match: ['配送'")
    expect(iGate).toBeGreaterThan(-1)
    expect(iDeliver).toBeGreaterThan(-1)
    expect(iGate, '起送规则排在配送规则之后 ⇒ 「不满六元配送吗」答不到点子上').toBeLessThan(iDeliver)
    const { ruleAssistantReply } = await import('../functions/lib/dify')
    const r = ruleAssistantReply('不满六元配送吗？')
    expect(r).toContain('不配送')
    expect(r).toContain('6.00')
    expect(read('src/data/assistantFaq.ts')).toContain('不满六元配送吗？')
  })

  it('登记册两行在册（C2 只保证「有行」，这里保证钉的就是这两行）', () => {
    const reg = read('docs/limit-provenance.md')
    expect(reg).toContain('functions/lib/shared.js | 常量 | MIN_DELIVERY_AMOUNT=6')
    expect(reg).toContain('src/data/deliveryLimits.ts | 常量 | MIN_DELIVERY_AMOUNT=6')
  })

  it('错误码三处齐备（真相源 state/409/false ⇄ 登记册 ⇄ 前端镜像），且禁静默本地兜底', async () => {
    const { ERRORS } = await import('../functions/lib/errors.js')
    expect(ERRORS.below_min_delivery).toEqual({ kind: 'state', status: 409, retryable: false })
    expect(read('src/api/error-codes.ts')).toMatch(/below_min_delivery: 'state',/)
    expect(read('docs/error-codes.md')).toMatch(/^\| below_min_delivery \| state \| 409 \| false \|/m)
    const { isFallbackSafe } = await import('../src/api/error-codes')
    // 这条是整个设计的要害：门槛是商家规矩（state），不许被兜成本地单；
    // 「屏上下单成功、商家侧根本没这张单」正是第十八轮那起丢单的形态。
    expect(isFallbackSafe({ errorCode: 'below_min_delivery', kind: 'state' })).toBe(false)
  })
})
