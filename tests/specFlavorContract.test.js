// 口味分隔符的前后端一致性契约。
//
// 「40g · 黄瓜味」这个串由前端合成（src/utils/spec-options.ts 的 specText）、
// 由后端放行并快照进 orders.items[].spec（functions/lib/actions/orders.js 的 allowedOrderSpecs），
// 再由后台订单 Tab 拆回口味（splitOrderSpec）。三处共用一个分隔符字面量，
// 任何一侧悄悄改成 '·' 或 ' / '，后台口味标签就会静默失灵（不报错，只是永远不显示）。
// 本用例把这条链钉成一次可逆往返。
import { describe, it, expect } from 'vitest'
import { allowedOrderSpecs } from '../functions/lib/actions/orders.js'
import { SPEC_FLAVOR_SEP, splitOrderSpec } from '../src/utils/spec-options'

const product = {
  spec: '40g',
  specOptions: [
    { label: '黄瓜味' },
    { label: '得克萨斯 · 烧烤味' },
    { label: '烤虾味', enabled: false },
  ],
}

describe('口味分隔符：前后端同一把尺', () => {
  const allowed = [...allowedOrderSpecs(product)]

  it('后端放行的口味组合 = 前端合成格式（不含被后台关掉的口味）', () => {
    expect(allowed).toEqual(['40g', `40g${SPEC_FLAVOR_SEP}黄瓜味`, `40g${SPEC_FLAVOR_SEP}得克萨斯 · 烧烤味`])
    expect(allowed.some((s) => s.includes('烤虾味'))).toBe(false)
  })

  it('后端快照串过一遍前端解析器，口味必须原样回来', () => {
    for (const spec of allowed) {
      const { base, flavor } = splitOrderSpec(spec)
      expect(base).toBe('40g')
      if (flavor) expect(`${base}${SPEC_FLAVOR_SEP}${flavor}`).toBe(spec)
    }
  })

  it('无静态规格的商品：口味串不带前导分隔符（否则后台标签会渲染成空括号）', () => {
    const bare = [...allowedOrderSpecs({ spec: '', specOptions: [{ label: '原味' }] })]
    expect(bare).toEqual(['', '原味'])
    expect(splitOrderSpec('原味')).toEqual({ base: '原味', flavor: '' })
  })
})
