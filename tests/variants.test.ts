// 变体解析层 variants.ts + 演示数据 variants-demo.ts
//
// 锁三件事：
//   ① 纯函数行为（key 拼接稳定性 / 组合解析 / 硬钉轴 / 自动回落 / 初始选择）
//   ② 一个真实缺陷的回归：白象方便面从「帮泡装+十三香」点「零售装」，
//      旧算法会因「帮泡装+十三香」匹配分更高而把用户刚点的零售装吃掉
//   ③ 诚实性判据：每个可售 combo 的 order / price / productName 必须与
//      products-seed.ts 的真实商品行逐字段相符 —— 「价格取自真实目录」这句话
//      由机器验证，而不是靠注释自称
import { describe, it, expect } from 'vitest'
import {
  COMBO_SEP,
  comboKey,
  parseComboKey,
  getVariantGroup,
  resolveCombo,
  hasAvailableCombo,
  groupImageOrders,
  groupPriceRange,
  pickCombo,
  initialSelection,
} from '../src/utils/variants'
import { VARIANT_GROUPS, variantGroupOf } from '../src/data/variants-demo'
import { products as seedProducts } from '../src/data/products-seed'

const byId = (id: string) => VARIANT_GROUPS.find((g) => g.id === id)!
const dongpeng = byId('dongpeng')
const tea = byId('master-kong-tea')
const baixiang = byId('baixiang-noodle')
const nongfu = byId('nongfu-water')

describe('comboKey / parseComboKey', () => {
  it('按 axes 声明顺序拼接，不受对象键插入顺序影响', () => {
    const a = comboKey(dongpeng, { pack: 'box', size: '250' })
    const b = comboKey(dongpeng, { size: '250', pack: 'box' })
    expect(a).toBe(b)
    expect(a).toBe(`box${COMBO_SEP}250`)
  })

  it('轴未取值时该段为空串（白象零售装不选口味）', () => {
    expect(comboKey(baixiang, { edition: 'retail', flavor: '' })).toBe('retail|')
  })

  it('往返一致：parseComboKey(comboKey(s)) === s', () => {
    const s = { pack: 'bottle', size: '500' }
    expect(parseComboKey(dongpeng, comboKey(dongpeng, s))).toEqual(s)
  })
})

describe('getVariantGroup / variantGroupOf', () => {
  it('order 为 number 或 string 都能命中（D1 回传两种类型）', () => {
    expect(getVariantGroup(VARIANT_GROUPS, 17)?.id).toBe('dongpeng')
    expect(getVariantGroup(VARIANT_GROUPS, '17')?.id).toBe('dongpeng')
  })

  it('不在演示数据里的商品返回 undefined（页面据此不渲染选择器）', () => {
    expect(getVariantGroup(VARIANT_GROUPS, 999)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, undefined)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, null)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, 'abc')).toBeUndefined()
  })

  it('variantGroupOf 是绑定同一份数据的等价入口', () => {
    expect(variantGroupOf(6)?.id).toBe('master-kong-tea')
    expect(variantGroupOf(6)).toBe(getVariantGroup(VARIANT_GROUPS, 6))
  })
})

describe('resolveCombo', () => {
  it('命中可售组合返回真实价格', () => {
    expect(resolveCombo(dongpeng, { pack: 'bottle', size: '500' })?.price).toBe(4.66)
  })

  it('不存在的组合返回 undefined，绝不编造价格（盒装没有 500ml）', () => {
    expect(resolveCombo(dongpeng, { pack: 'box', size: '500' })).toBeUndefined()
  })

  it('key 完全对不上也返回 undefined', () => {
    expect(resolveCombo(tea, { flavor: '不存在的口味' })).toBeUndefined()
  })
})

describe('hasAvailableCombo', () => {
  it('盒装虽无 500ml，但盒装本身有可售组合 → 不是死选项', () => {
    expect(hasAvailableCombo(dongpeng, 'pack', 'box')).toBe(true)
  })

  it('未知轴 / 未知选项一律 false', () => {
    expect(hasAvailableCombo(dongpeng, 'nope', 'box')).toBe(false)
    expect(hasAvailableCombo(dongpeng, 'pack', 'nope')).toBe(false)
  })

  it('康师傅 8 个口味全部可售', () => {
    for (const opt of tea.axes[0].options) {
      expect(hasAvailableCombo(tea, 'flavor', opt.id)).toBe(true)
    }
  })
})

describe('groupImageOrders / groupPriceRange', () => {
  it('东鹏三档 → 三个真实 order（三张实拍图）', () => {
    expect(groupImageOrders(dongpeng)).toEqual([16, 17, 18])
  })

  it('白象帮泡装三个口味共用 order 46 → 去重后只剩 46、47', () => {
    expect(groupImageOrders(baixiang)).toEqual([46, 47])
  })

  it('不可售组合不进图集', () => {
    const fake = {
      ...dongpeng,
      combos: {
        'box|250': { price: 2.33, order: 16, productName: 'x', available: true },
        'box|500': { price: 0, order: 99, productName: 'x', available: false },
      },
    }
    expect(groupImageOrders(fake)).toEqual([16])
  })

  it('价格区间取自真实价（东鹏 2.33 ~ 4.66；农夫山泉 1.66 ~ 2.88）', () => {
    expect(groupPriceRange(dongpeng)).toEqual({ min: 2.33, max: 4.66 })
    expect(groupPriceRange(nongfu)).toEqual({ min: 1.66, max: 2.88 })
  })

  it('全组不可售时区间归零而非 ±Infinity（避免渲染出 ¥Infinity）', () => {
    const fake = {
      ...nongfu,
      combos: { '550': { price: 1.66, order: 27, productName: 'x', available: false } },
    }
    expect(groupPriceRange(fake)).toEqual({ min: 0, max: 0 })
  })
})

describe('pickCombo —— 硬钉刚改动的轴', () => {
  it('【缺陷回归】白象从「帮泡装+十三香」点「零售装」必须落到零售装，不能被旧口味拉回帮泡装', () => {
    const r = pickCombo(baixiang, { edition: 'retail', flavor: 'shisanxiang' }, 'edition')
    expect(r?.selection).toEqual({ edition: 'retail', flavor: '' })
    expect(r?.combo.price).toBe(1.88)
    expect(r?.combo.order).toBe(47)
  })

  it('东鹏点「盒装」而当前容量 500ml → 容量自动回落 250ml（不存在的组合不硬灰）', () => {
    const r = pickCombo(dongpeng, { pack: 'box', size: '500' }, 'pack')
    expect(r?.selection).toEqual({ pack: 'box', size: '250' })
    expect(r?.combo.price).toBe(2.33)
  })

  it('东鹏点「500ml」而当前包装盒装 → 包装翻到瓶装（刚点的那项一定生效）', () => {
    const r = pickCombo(dongpeng, { pack: 'box', size: '500' }, 'size')
    expect(r?.selection).toEqual({ pack: 'bottle', size: '500' })
    expect(r?.combo.price).toBe(4.66)
  })

  it('白象点口味时保留当前版本', () => {
    const r = pickCombo(baixiang, { edition: 'help-soak', flavor: 'mala' }, 'flavor')
    expect(r?.selection).toEqual({ edition: 'help-soak', flavor: 'mala' })
  })

  it('不传硬钉轴时按匹配数打分，并列取声明顺序靠前者', () => {
    expect(pickCombo(dongpeng, { size: '250' })?.combo.order).toBe(16)
  })

  it('空 pinned 取第一个可售组合', () => {
    expect(pickCombo(dongpeng, {})?.combo.order).toBe(16)
  })

  it('全组不可售返回 null（页面据此禁用加购而不是崩）', () => {
    const fake = {
      ...nongfu,
      combos: { '550': { price: 1.66, order: 27, productName: 'x', available: false } },
    }
    expect(pickCombo(fake, {})).toBeNull()
  })
})

describe('initialSelection', () => {
  it('按当前商品真实 order 反查初始选中项', () => {
    expect(initialSelection(dongpeng, 17)).toEqual({ pack: 'bottle', size: '250' })
    expect(initialSelection(dongpeng, 18)).toEqual({ pack: 'bottle', size: '500' })
    expect(initialSelection(tea, 53)).toEqual({ flavor: 'jasmine-clear' })
  })

  it('order 是字符串也能反查', () => {
    expect(initialSelection(nongfu, '24')).toEqual({ size: '1500' })
  })

  it('order 不在任何可售组合里 → 回落第一个可售组合', () => {
    expect(initialSelection(dongpeng, 999)).toEqual({ pack: 'box', size: '250' })
    expect(initialSelection(dongpeng, undefined)).toEqual({ pack: 'box', size: '250' })
  })
})

describe('诚实性判据：演示数据必须与真实目录逐字段相符', () => {
  const rows = new Map(seedProducts.map((p) => [Number(p.order), p]))

  it('每个可售 combo 的 order 都是目录里真实存在的商品行', () => {
    for (const g of VARIANT_GROUPS) {
      for (const [key, combo] of Object.entries(g.combos)) {
        if (!combo.available) continue
        expect(rows.has(combo.order), `${g.id}/${key} 的 order ${combo.order} 不在 products-seed.ts`).toBe(true)
      }
    }
  })

  it('每个可售 combo 的价格与商品名等于真实行（防止"真实数据"退化成注释自称）', () => {
    for (const g of VARIANT_GROUPS) {
      for (const [key, combo] of Object.entries(g.combos)) {
        if (!combo.available) continue
        const row = rows.get(combo.order)!
        expect(combo.price, `${g.id}/${key} 价格`).toBe(row.price)
        expect(combo.productName, `${g.id}/${key} 商品名`).toBe(row.name)
      }
    }
  })

  it('memberOrders 全部是真实商品行，且每个 order 至少落在一个可售组合里', () => {
    for (const g of VARIANT_GROUPS) {
      const covered = new Set(
        Object.values(g.combos).filter((c) => c.available).map((c) => c.order),
      )
      for (const o of g.memberOrders) {
        expect(rows.has(o), `${g.id} 的 memberOrder ${o} 不在 products-seed.ts`).toBe(true)
        expect(covered.has(o), `${g.id} 的 memberOrder ${o} 没有对应可售组合，进该商品详情页会选不中自己`).toBe(true)
      }
    }
  })

  it('不可售组合不得带非零价格（否则会被人误当成真实标价）', () => {
    for (const g of VARIANT_GROUPS) {
      for (const [key, combo] of Object.entries(g.combos)) {
        if (combo.available) continue
        expect(combo.price, `${g.id}/${key} 标了 available:false 却带价格`).toBe(0)
      }
    }
  })

  it('color 轴的每个选项都有 swatch，spec 轴不靠色块表意', () => {
    for (const g of VARIANT_GROUPS) {
      for (const axis of g.axes) {
        for (const opt of axis.options) {
          if (axis.kind === 'color') {
            expect(opt.swatch, `${g.id}/${axis.id}/${opt.id} 缺 swatch`).toBeTruthy()
            expect(opt.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/)
          }
          expect(opt.label).toBeTruthy()
        }
      }
    }
  })

  it('每组都带真实性声明 disclosure（演示聚合必须如实标注）', () => {
    for (const g of VARIANT_GROUPS) {
      expect(g.disclosure, `${g.id} 缺 disclosure`).toBeTruthy()
      expect(g.disclosure!.length).toBeGreaterThan(10)
    }
  })

  it('同一 order 不得同时属于两个变体组（否则详情页选组不确定）', () => {
    const seen = new Map<number, string>()
    for (const g of VARIANT_GROUPS) {
      for (const o of g.memberOrders) {
        expect(seen.has(o), `order ${o} 同时属于 ${seen.get(o)} 与 ${g.id}`).toBe(false)
        seen.set(o, g.id)
      }
    }
  })
})
