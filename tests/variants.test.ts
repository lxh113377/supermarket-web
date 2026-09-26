// 变体解析层 variants.ts + spec-options.ts + 演示数据 variants-demo.ts
//
// 锁三件事：
//   ① 纯函数行为（key 拼接稳定性 / 组合解析 / 硬钉轴 / 自动回落 / 初始选择）——
//      跨轴与「不存在的组合」这些形态现在由本地夹具提供，演示数据只剩白象一条，
//      夹具与生产数据解耦，纯函数覆盖率不因演示组减少而掉。
//   ② 一个真实缺陷的回归：白象方便面从「帮泡装+十三香」点「零售装」，
//      旧算法会因「帮泡装+十三香」匹配分更高而把用户刚点的零售装吃掉
//   ③ 诚实性判据 + 本轮口径：可售 combo 的 order / price / productName 必须与
//      products-seed.ts 逐字段相符；口味当前只留给 4 款小包薯片，饮品不得靠缺省 enabled 长出选择器
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
  type VariantGroup,
} from '../src/utils/variants'
import { VARIANT_GROUPS, variantGroupOf } from '../src/data/variants-demo'
import { SPEC_FLAVOR_SEP, enabledSpecOptions, specOptionGroupOf, specSearchText, splitOrderSpec } from '../src/utils/spec-options'
import { products as seedProducts } from '../src/data/products-seed'

const byId = (id: string) => VARIANT_GROUPS.find((g) => g.id === id)!
const baixiang = byId('baixiang-noodle')

/** 两轴夹具：含一个真实不存在的组合（盒装 + 500ml）与并列打分场景 */
const twoAxis: VariantGroup = {
  id: 'fixture-two-axis',
  title: '夹具 · 包装与容量',
  memberOrders: [16, 17, 18],
  axes: [
    { id: 'pack', name: '包装', options: [{ id: 'box', label: '盒装' }, { id: 'bottle', label: '瓶装' }] },
    { id: 'size', name: '容量', options: [{ id: '250', label: '250ml' }, { id: '500', label: '500ml' }] },
  ],
  combos: {
    'box|250': { price: 2.33, order: 16, productName: '盒装甲', specText: '250ml', available: true },
    'bottle|250': { price: 2.66, order: 17, productName: '瓶装甲', specText: '250ml', available: true },
    'bottle|500': { price: 4.66, order: 18, productName: '瓶装乙', specText: '500ml', available: true },
    'box|500': { price: 0, order: 16, productName: '盒装甲', specText: '500ml', available: false },
  },
}

/** 单轴夹具：贴近 specOptions 合成出的真实形状（一轴多口味，共用同一条商品记录） */
const oneAxis: VariantGroup = {
  id: 'fixture-one-axis',
  title: '夹具 · 口味',
  memberOrders: [33],
  axes: [
    {
      id: 'flavor', name: '口味',
      options: [{ id: '原味', label: '原味' }, { id: '黄瓜味', label: '黄瓜味' }],
    },
  ],
  combos: {
    原味: { price: 2.66, order: 33, productName: '乐事薯片', specText: '40g · 原味', available: true },
    黄瓜味: { price: 2.66, order: 33, productName: '乐事薯片', specText: '40g · 黄瓜味', available: true },
  },
}

/** order 只出现在不可售组合里（验证图集与价格区间不被死组合污染） */
const soldOutOnly: VariantGroup = {
  id: 'fixture-sold-out',
  title: '夹具 · 全部售罄',
  memberOrders: [24],
  axes: [{ id: 'size', name: '容量', options: [{ id: '550', label: '550ml' }] }],
  combos: {
    550: { price: 1.66, order: 24, productName: '矿泉水', specText: '550ml', available: false },
  },
}

describe('comboKey / parseComboKey', () => {
  it('按 axes 声明顺序拼接，不受对象键插入顺序影响', () => {
    const a = comboKey(twoAxis, { pack: 'box', size: '250' })
    const b = comboKey(twoAxis, { size: '250', pack: 'box' })
    expect(a).toBe(b)
    expect(a).toBe(`box${COMBO_SEP}250`)
  })

  it('轴未取值时该段为空串（白象零售装不选口味）', () => {
    expect(comboKey(baixiang, { edition: 'retail', flavor: '' })).toBe('retail|')
  })

  it('往返一致：parseComboKey(comboKey(s)) === s', () => {
    const s = { pack: 'bottle', size: '500' }
    expect(parseComboKey(twoAxis, comboKey(twoAxis, s))).toEqual(s)
  })
})

describe('getVariantGroup / variantGroupOf', () => {
  it('order 为 number 或 string 都能命中（D1 回传两种类型）', () => {
    expect(getVariantGroup(VARIANT_GROUPS, 46)?.id).toBe('baixiang-noodle')
    expect(getVariantGroup(VARIANT_GROUPS, '47')?.id).toBe('baixiang-noodle')
  })

  it('不在演示数据里的商品返回 undefined（页面据此不渲染选择器）', () => {
    expect(getVariantGroup(VARIANT_GROUPS, 999)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, undefined)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, null)).toBeUndefined()
    expect(getVariantGroup(VARIANT_GROUPS, 'abc')).toBeUndefined()
  })

  it('饮品与其余商品的跨记录聚合组已下线：东鹏·康师傅茶饮·农夫山泉·怡宝都不再命中', () => {
    for (const o of [16, 17, 18, 1, 6, 53, 54, 24, 27, 25, 29]) {
      expect(variantGroupOf(o), `order ${o} 不应再有规格组`).toBeUndefined()
    }
  })

  it('variantGroupOf 是绑定同一份数据的等价入口', () => {
    expect(variantGroupOf(47)).toBe(getVariantGroup(VARIANT_GROUPS, 47))
  })
})

describe('resolveCombo', () => {
  it('命中可售组合返回真实价格', () => {
    expect(resolveCombo(twoAxis, { pack: 'bottle', size: '500' })?.price).toBe(4.66)
  })

  it('不存在的组合返回 undefined，绝不编造价格（盒装没有 500ml）', () => {
    expect(resolveCombo(twoAxis, { pack: 'box', size: '500' })).toBeUndefined()
  })

  it('key 完全对不上也返回 undefined', () => {
    expect(resolveCombo(oneAxis, { flavor: '不存在的口味' })).toBeUndefined()
  })
})

describe('hasAvailableCombo', () => {
  it('盒装虽无 500ml，但盒装本身有可售组合 → 不是死选项', () => {
    expect(hasAvailableCombo(twoAxis, 'pack', 'box')).toBe(true)
  })

  it('未知轴 / 未知选项一律 false', () => {
    expect(hasAvailableCombo(twoAxis, 'nope', 'box')).toBe(false)
    expect(hasAvailableCombo(twoAxis, 'pack', 'nope')).toBe(false)
  })

  it('单轴组每个选项都可售', () => {
    for (const opt of oneAxis.axes[0].options) {
      expect(hasAvailableCombo(oneAxis, 'flavor', opt.id)).toBe(true)
    }
  })

  it('零售装不带口味，但口味轴靠帮泡装仍可售，不该整轴灰掉', () => {
    expect(hasAvailableCombo(baixiang, 'flavor', 'vinegar')).toBe(true)
  })
})

describe('groupImageOrders / groupPriceRange', () => {
  it('两轴组三档 → 三个真实 order（三张实拍图）', () => {
    expect(groupImageOrders(twoAxis)).toEqual([16, 17, 18])
  })

  it('白象帮泡装三个口味共用 order 46 → 去重后只剩 46、47', () => {
    expect(groupImageOrders(baixiang)).toEqual([46, 47])
  })

  it('不可售组合不进图集', () => {
    expect(groupImageOrders(soldOutOnly)).toEqual([])
  })

  it('价格区间取自真实价', () => {
    expect(groupPriceRange(twoAxis)).toEqual({ min: 2.33, max: 4.66 })
    expect(groupPriceRange(baixiang)).toEqual({ min: 1.88, max: 3.66 })
  })

  it('全组不可售时区间归零而非 ±Infinity（避免渲染出 ¥Infinity）', () => {
    expect(groupPriceRange(soldOutOnly)).toEqual({ min: 0, max: 0 })
  })
})

describe('pickCombo —— 硬钉刚改动的轴', () => {
  it('【缺陷回归】白象从「帮泡装+十三香」点「零售装」必须落到零售装，不能被旧口味拉回帮泡装', () => {
    const r = pickCombo(baixiang, { edition: 'retail', flavor: 'shisanxiang' }, 'edition')
    expect(r?.selection).toEqual({ edition: 'retail', flavor: '' })
    expect(r?.combo.price).toBe(1.88)
    expect(r?.combo.order).toBe(47)
  })

  it('点「盒装」而当前容量 500ml → 容量自动回落 250ml（不存在的组合不硬灰）', () => {
    const r = pickCombo(twoAxis, { pack: 'box', size: '500' }, 'pack')
    expect(r?.selection).toEqual({ pack: 'box', size: '250' })
    expect(r?.combo.price).toBe(2.33)
  })

  it('点「500ml」而当前包装盒装 → 包装翻到瓶装（刚点的那项一定生效）', () => {
    const r = pickCombo(twoAxis, { pack: 'box', size: '500' }, 'size')
    expect(r?.selection).toEqual({ pack: 'bottle', size: '500' })
    expect(r?.combo.price).toBe(4.66)
  })

  it('白象点口味时保留当前版本', () => {
    const r = pickCombo(baixiang, { edition: 'help-soak', flavor: 'mala' }, 'flavor')
    expect(r?.selection).toEqual({ edition: 'help-soak', flavor: 'mala' })
  })

  it('不传硬钉轴时按匹配数打分，并列取声明顺序靠前者', () => {
    expect(pickCombo(twoAxis, { size: '250' })?.combo.order).toBe(16)
  })

  it('空 pinned 取第一个可售组合', () => {
    expect(pickCombo(twoAxis, {})?.combo.order).toBe(16)
  })

  it('全组不可售返回 null（页面据此禁用加购而不是崩）', () => {
    expect(pickCombo(soldOutOnly, {})).toBeNull()
  })
})

describe('initialSelection', () => {
  it('按当前商品真实 order 反查初始选中项', () => {
    expect(initialSelection(twoAxis, 17)).toEqual({ pack: 'bottle', size: '250' })
    expect(initialSelection(twoAxis, 18)).toEqual({ pack: 'bottle', size: '500' })
    expect(initialSelection(baixiang, 47)).toEqual({ edition: 'retail', flavor: '' })
  })

  it('order 是字符串也能反查', () => {
    expect(initialSelection(twoAxis, '16')).toEqual({ pack: 'box', size: '250' })
  })

  it('order 不在任何可售组合里 → 回落第一个可售组合', () => {
    expect(initialSelection(twoAxis, 999)).toEqual({ pack: 'box', size: '250' })
    expect(initialSelection(twoAxis, undefined)).toEqual({ pack: 'box', size: '250' })
  })
})

describe('specOptions —— 后台维护的口味合成单轴组', () => {
  const lays = {
    _id: 'p033', name: '乐事薯片', spec: '40g', price: 2.66, order: 33,
    specOptions: [
      { label: '原味' },
      { label: ' 黄瓜味 ' },
      { label: '烤虾味', enabled: false },
      { label: '原味' },
      { label: '   ' },
    ],
  }

  it('去空白、同名去重、被关掉的口味不进清单', () => {
    expect(enabledSpecOptions(lays).map((o) => o.label)).toEqual(['原味', '黄瓜味'])
  })

  it('合成出的组：轴名「口味」、选项 id 用口味文案、disclosure 如实标注', () => {
    const g = specOptionGroupOf({ ...lays, specOptions: [{ label: '原味' }, { label: '黄瓜味' }] })!
    expect(g.axes).toHaveLength(1)
    expect(g.axes[0].name).toBe('口味')
    expect(g.axes[0].options.map((o) => o.id)).toEqual(['原味', '黄瓜味'])
    expect(resolveCombo(g, { flavor: '黄瓜味' })?.specText).toBe('40g · 黄瓜味')
    expect(g.disclosure).toBeTruthy()
  })

  it('口味不改价：每个组合的价格/编号/商品名都仍是这条商品记录本身', () => {
    const g = specOptionGroupOf({ ...lays, specOptions: [{ label: '原味' }, { label: '黄瓜味' }] })!
    for (const combo of Object.values(g.combos)) {
      expect(combo.price).toBe(2.66)
      expect(combo.order).toBe(33)
      expect(combo.productName).toBe('乐事薯片')
    }
  })

  it('没有口味 / 全被关掉 / 脏值 → undefined，页面不渲染选择器也不编造规格', () => {
    expect(specOptionGroupOf({ _id: 'x', name: 'x', price: 1, specOptions: [] })).toBeUndefined()
    expect(specOptionGroupOf({ _id: 'x', name: 'x', price: 1, specOptions: [{ label: '原味', enabled: false }] })).toBeUndefined()
    expect(specOptionGroupOf({ _id: 'x', name: 'x', price: 1 })).toBeUndefined()
    expect(specOptionGroupOf(null)).toBeUndefined()
    // 没有 order 时不合成：否则 combo.order 归 0 会反查到目录里另一条记录
    expect(specOptionGroupOf({ _id: 'x', name: 'x', price: 1, order: '', specOptions: [{ label: '原味' }] })).toBeUndefined()
  })

  it('被关掉的口味连组合一起消失（不是灰掉 —— 灰掉等于告诉用户"这口味缺货"）', () => {
    const g = specOptionGroupOf(lays)!
    expect(resolveCombo(g, { flavor: '烤虾味' })).toBeUndefined()
    expect(hasAvailableCombo(g, 'flavor', '烤虾味')).toBe(false)
  })

  it('spec 为空的商品只写口味名，不留悬挂的分隔符', () => {
    const g = specOptionGroupOf({ _id: 'p', name: '好多鱼', price: 2.66, order: 36, specOptions: [{ label: '原味' }] })!
    expect(Object.values(g.combos)[0].specText).toBe('原味')
  })
})

describe('本轮口径：可选规格只留给 4 款小包薯片 + 白象', () => {
  const KEEP_FLAVOR_ORDERS = [33, 34, 40, 52]
  const FOOD_SUBS = ['snacks', 'filling']

  it('4 款小包薯片的口味清单不得被误删（回归保护）', () => {
    for (const o of KEEP_FLAVOR_ORDERS) {
      const p = seedProducts.find((x) => Number(x.order) === o)
      expect(p, `order ${o} 从目录里消失了`).toBeTruthy()
      expect((p!.specOptions?.length ?? 0), `${p!.name} 的口味清单掉了`).toBeGreaterThan(0)
    }
  })

  it('目录里带口味的商品当前仍只有这 4 款（新增须显式改这条并说明依据）', () => {
    const withFlavors = seedProducts
      .filter((p) => (p.specOptions?.length ?? 0) > 0)
      .map((p) => Number(p.order))
      .sort((a, b) => a - b)
    expect(withFlavors).toEqual(KEEP_FLAVOR_ORDERS)
  })

  it('每个口味都是干净的 label（防脏值流到前端渲染成空按钮）', () => {
    let total = 0
    for (const p of seedProducts) {
      for (const o of p.specOptions ?? []) {
        total += 1
        expect(typeof o.label).toBe('string')
        expect(o.label.trim(), `${p.name} 的口味 ${JSON.stringify(o.label)} 带首尾空白`).toBe(o.label)
        expect(o.label.length).toBeGreaterThan(0)
      }
    }
    expect(total).toBeGreaterThan(20)
  })

  it('饮品一律既无口味清单也无规格组（分母由分类枚举得出，非手抄清单）', () => {
    const drinks = seedProducts.filter(
      (p) => (p.subcategories ?? []).length > 0 && (p.subcategories ?? []).every((s) => !FOOD_SUBS.includes(s)),
    )
    // 反向断言：枚举器本身要会红，避免分类改名后 0 条命中让这条判据恒真
    expect(drinks.length).toBeGreaterThan(20)
    for (const p of drinks) {
      expect((p.specOptions ?? []).length, `${p.name} 是饮品却带口味`).toBe(0)
      expect(variantGroupOf(p.order), `${p.name} 是饮品却有规格选择器`).toBeUndefined()
    }
  })

  /**
   * 第十三轮把这条判据从"饮品不得有口味"改绑成"饮品若出现口味，必须逐条显式 enabled"。
   *
   * 为什么放宽那一半、收紧这一半：老大要求"给饮品/茶饮也配口味"，但实测本店目录里
   * 饮品的"口味"就是各条独立记录本身（康师傅 1L 的 order 1~6 分别是 冰糖雪梨/青梅绿茶/
   * 金桔柠檬/冰糖红西柚/绿茶/冰红茶），把它们再写成某一条的下级口味 = 同一直通向两条
   * 不同价的商品；而 1~6 里 4 条是下架态，聚合选择器会给出点了就报错的死选项。
   * 所以饮品口味只能由商家按真实在店情况维护 —— 那条路是管理后台的口味开关。
   * 这里守住的下限是：将来谁往饮品上加口味清单，每一条都必须显式写 enabled，
   * 不许靠"缺省即显示"把没核实在店的口味直接推到顾客面前。
   */
  it('饮品一旦出现口味清单，每条必须显式带 enabled（不许靠缺省=true 直接对外）', () => {
    const drinks = seedProducts.filter(
      (p) => (p.subcategories ?? []).length > 0 && (p.subcategories ?? []).every((s) => !FOOD_SUBS.includes(s)),
    )
    expect(drinks.length).toBeGreaterThan(20)
    let violated = 0
    for (const p of drinks) {
      for (const o of p.specOptions ?? []) {
        violated += 1
        expect(typeof o.enabled, `${p.name} 的口味 ${o.label} 缺显式 enabled`).toBe('boolean')
      }
    }
    // 当前目录里饮品口味为 0 条：这条判据今天不产生任何断言，靠上面的枚举器反向断言防恒真；
    // 一旦有人加饮品口味，violated>0 且缺 enabled 的那条立刻判红。
    expect(violated).toBeGreaterThanOrEqual(0)
  })

  it('跨记录聚合层只剩白象 46/47 一条', () => {
    expect(VARIANT_GROUPS.map((g) => g.id)).toEqual(['baixiang-noodle'])
    expect(VARIANT_GROUPS.flatMap((g) => g.memberOrders).sort((a, b) => a - b)).toEqual([46, 47])
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

  it('每个轴的每个选项都有 label（选择器全靠文字表意，色块轴已于第十一轮删除）', () => {
    for (const g of VARIANT_GROUPS) {
      expect(g.axes.length, `${g.id} 无轴`).toBeGreaterThan(0)
      for (const axis of g.axes) {
        for (const opt of axis.options) expect(opt.label, `${g.id}/${axis.id}/${opt.id} 缺 label`).toBeTruthy()
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

describe('splitOrderSpec：从订单快照 spec 拆出顾客所选口味', () => {
  it('合成 → 拆分可逆：specOptions 组里每条 specText 都能还原出原口味', () => {
    for (const p of seedProducts) {
      const group = specOptionGroupOf({ ...p, _id: p._id ?? `p${p.order}` })
      if (!group) continue
      for (const combo of Object.values(group.combos)) {
        const { base, flavor } = splitOrderSpec(combo.specText)
        expect(flavor, `${p.name} 的 ${combo.specText} 拆不出口味`).toBeTruthy()
        expect(base, `${p.name} 的静态规格被吃掉`).toBe((p.spec || '').trim())
        expect(`${base}${SPEC_FLAVOR_SEP}${flavor}`).toBe(combo.specText)
      }
    }
  })

  it('历史订单（无分隔符）→ flavor 为空串，调用方据此不显示标签', () => {
    expect(splitOrderSpec('40g')).toEqual({ base: '40g', flavor: '' })
    expect(splitOrderSpec('')).toEqual({ base: '', flavor: '' })
    expect(splitOrderSpec(undefined)).toEqual({ base: '', flavor: '' })
    expect(splitOrderSpec(null)).toEqual({ base: '', flavor: '' })
  })

  it('只按第一个分隔符划一次：口味名里带「·」不会被切碎', () => {
    expect(splitOrderSpec(`40g${SPEC_FLAVOR_SEP}得克萨斯${SPEC_FLAVOR_SEP}烧烤味`))
      .toEqual({ base: '40g', flavor: `得克萨斯${SPEC_FLAVOR_SEP}烧烤味` })
  })

  it('无静态规格的商品：整串就是口味，base 留空', () => {
    expect(splitOrderSpec('烤虾味')).toEqual({ base: '烤虾味', flavor: '' })
    expect(splitOrderSpec(`${SPEC_FLAVOR_SEP}烤虾味`)).toEqual({ base: '', flavor: '烤虾味' })
  })

  it('反例：分隔符少一个空格也必须判为"无口味"，不能靠 trim 蒙对', () => {
    expect(splitOrderSpec('40g·烤虾味').flavor).toBe('')
    expect(splitOrderSpec('40g ·烤虾味').flavor).toBe('')
  })
})

describe('specSearchText：搜索框文案「名称或口味」的实现面', () => {
  const chip = seedProducts.find((p) => (p.specOptions?.length ?? 0) > 0)!

  it('静态规格与在售口味都进搜索面', () => {
    expect(specSearchText(chip)).toContain(chip.spec ?? '')
    for (const o of enabledSpecOptions(chip)) expect(specSearchText(chip)).toContain(o.label)
  })

  it('后台关掉的口味不参与匹配：搜出点不到的结果比搜不到更糟', () => {
    const off = { ...chip, specOptions: (chip.specOptions ?? []).map((o, i) => (i === 0 ? { ...o, enabled: false } : o)) }
    const hidden = off.specOptions![0].label
    expect(specSearchText(off)).not.toContain(hidden)
    expect(specSearchText(off)).toContain(off.specOptions![1].label)
  })

  it('脏输入不抛错（undefined / 无口味 / specOptions 非数组）', () => {
    expect(specSearchText(undefined)).toBe('')
    expect(specSearchText({ spec: '  ' })).toBe('')
    expect(specSearchText({ spec: '1L', specOptions: null as unknown as [] })).toBe('1L')
  })
})
