// 跨记录的规格聚合层（本地演示层）—— 不接后端、不进 D1、不参与下单接口。
//
// 【范围口径】这里只保留「同一个商品的多个规格在目录里是几条独立记录」的那一类：
// 白象方便面帮泡装（order 46）与零售装（order 47）是两条真实记录，价格与实拍图各自不同，
// 聚成一个变体组让用户在详情页直接切换。
// 单一商品自己的可选口味不在这里 —— 那是商品自带数据，由管理后台写进 D1 的
// products.specOptions，前端在 utils/spec-options.ts 里合成，同样走 VariantPicker。
//
// 【真实性口径】每个 combo 的 order / price / productName / specText 都逐行取自
// src/data/products-seed.ts 的真实商品行；图片经 utils/images.ts 拼成
// /images/{order}.webp（仓库内真实商品实拍图），不生成、不占位、不编造。
//
// 【演示口径】聚合关系（哪几行算同一组、轴的命名）属演示交互，页面在 disclosure 处如实标注。
import { getVariantGroup, type VariantGroup } from '../utils/variants'

export const VARIANT_GROUPS: VariantGroup[] = [
  {
    id: 'baixiang-noodle',
    title: '白象方便面 · 版本与口味',
    memberOrders: [46, 47],
    disclosure: '口味选项取自目录中帮泡装记录的真实规格文案「帮泡+可选十三香/麻辣香/山西老陈醋」；零售装记录未提供口味选项，故选中零售装时口味轴自动置空并禁用。两条记录的价格与图片均为真实值，聚合为变体轴属演示交互。',
    axes: [
      {
        id: 'edition',
        name: '版本',
        kind: 'spec',
        options: [
          { id: 'help-soak', label: '帮泡装' },
          { id: 'retail', label: '零售装' },
        ],
      },
      {
        id: 'flavor',
        name: '口味',
        kind: 'spec',
        options: [
          { id: 'shisanxiang', label: '十三香' },
          { id: 'mala', label: '麻辣香' },
          { id: 'vinegar', label: '山西老陈醋' },
        ],
      },
    ],
    combos: {
      'help-soak|shisanxiang': { price: 3.66, order: 46, productName: '白象方便面', specText: '帮泡装 · 十三香', available: true },
      'help-soak|mala': { price: 3.66, order: 46, productName: '白象方便面', specText: '帮泡装 · 麻辣香', available: true },
      'help-soak|vinegar': { price: 3.66, order: 46, productName: '白象方便面', specText: '帮泡装 · 山西老陈醋', available: true },
      // 零售装在真实记录里没有口味选项 —— 口味段留空，选中零售装时页面把口味轴置空并禁用
      'retail|': { price: 1.88, order: 47, productName: '白象方便面', specText: '零售装', available: true },
    },
  },
]

/** 按真实商品 order 取变体组（列表页做「¥x.xx 起」、详情页做选择器都走这一个入口） */
export function variantGroupOf(order?: number | string | null): VariantGroup | undefined {
  return getVariantGroup(VARIANT_GROUPS, order)
}
