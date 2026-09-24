// 变体演示数据（本地演示层）—— 不接后端、不进 D1、不参与下单接口。
//
// 【真实性口径】每个 combo 的 order / price / productName / specText 都逐行取自
// src/data/products-seed.ts 的真实商品行；图片经 utils/images.ts 拼成
// /images/{order}.webp（仓库内 55 张真实商品实拍图），不生成、不占位、不编造。
//
// 【演示口径】目录里「同一商品的多个规格」本就是多条独立记录（如东鹏特饮有
// 盒装250ml / 瓶装250ml / 瓶装500ml 三行）。把它们聚成一个变体组、用选择器切换，
// 是本页新增的**演示交互**；聚合关系（哪几行算同一组、轴的命名）是演示数据，
// 单行商品自身的价格/规格/图片仍是真实值。页面在 disclosure 处如实标注。
//
// 【色块口径】swatch 只是包装主色的示意色块（装饰用），真实属性以 label 文案为准。
import { getVariantGroup, type VariantGroup } from '../utils/variants'

export const VARIANT_GROUPS: VariantGroup[] = [
  {
    id: 'dongpeng',
    title: '东鹏特饮 · 包装与容量',
    memberOrders: [16, 17, 18],
    disclosure: '目录中「盒装东鹏特饮 250ml / 瓶装东鹏特饮 250ml / 东鹏特饮 500ml」是三条独立真实商品记录，此处聚合为同一商品的两个变体轴（演示交互）；单价与图片均取自各自真实记录。',
    axes: [
      {
        id: 'pack',
        name: '包装',
        kind: 'spec',
        options: [
          { id: 'box', label: '盒装' },
          { id: 'bottle', label: '瓶装' },
        ],
      },
      {
        id: 'size',
        name: '容量',
        kind: 'spec',
        options: [
          { id: '250', label: '250ml' },
          { id: '500', label: '500ml' },
        ],
      },
    ],
    combos: {
      // 盒装 + 500ml 在真实目录中不存在 —— 不编造价格，标 available:false，
      // 页面由 pickCombo 自动把容量回落到 250ml。
      'box|250': { price: 2.33, order: 16, productName: '盒装东鹏特饮', specText: '250ml', available: true },
      'bottle|250': { price: 2.66, order: 17, productName: '瓶装东鹏特饮', specText: '250ml', available: true },
      'bottle|500': { price: 4.66, order: 18, productName: '东鹏特饮', specText: '500ml', available: true },
      'box|500': { price: 0, order: 16, productName: '盒装东鹏特饮', specText: '500ml', available: false },
    },
  },
  {
    id: 'master-kong-tea',
    title: '康师傅 1L 茶饮 · 口味',
    memberOrders: [1, 2, 3, 4, 5, 6, 53, 54],
    disclosure: '以下每个口味在目录中都是独立的真实商品记录（各有自己的编号、单价与实拍图），此处聚合为同一系列的口味变体轴（演示交互）。色块为包装主色示意，真实属性以口味名为准。',
    axes: [
      {
        id: 'flavor',
        name: '口味',
        kind: 'color',
        options: [
          { id: 'blacktea', label: '冰红茶', swatch: '#B3261E' },
          { id: 'greentea', label: '绿茶', swatch: '#4C7A34' },
          { id: 'jasmine-clear', label: '茉莉清茶', swatch: '#2F6F62' },
          { id: 'jasmine-honey', label: '茉莉蜜茶', swatch: '#C08A2E' },
          { id: 'pear', label: '冰糖雪梨', swatch: '#D9A520' },
          { id: 'plum-green', label: '青梅绿茶', swatch: '#7A9A3B' },
          { id: 'kumquat', label: '金桔柠檬', swatch: '#E08A1E' },
          { id: 'grapefruit', label: '冰糖红西柚', swatch: '#D2455F' },
        ],
      },
    ],
    combos: {
      blacktea: { price: 3.66, order: 6, productName: '康师傅冰红茶', specText: '1L', available: true },
      greentea: { price: 3.66, order: 5, productName: '康师傅绿茶', specText: '1L', available: true },
      'jasmine-clear': { price: 3.5, order: 53, productName: '康师傅茉莉清茶', specText: '1L', available: true },
      'jasmine-honey': { price: 3.5, order: 54, productName: '康师傅茉莉蜜茶', specText: '1L', available: true },
      pear: { price: 2.66, order: 1, productName: '康师傅冰糖雪梨', specText: '1L', available: true },
      'plum-green': { price: 2.66, order: 2, productName: '康师傅青梅绿茶', specText: '1L', available: true },
      kumquat: { price: 2.66, order: 3, productName: '康师傅金桔柠檬', specText: '1L', available: true },
      grapefruit: { price: 3.66, order: 4, productName: '康师傅冰糖红西柚', specText: '1L', available: true },
    },
  },
  {
    id: 'nongfu-water',
    title: '农夫山泉矿泉水 · 容量',
    memberOrders: [24, 27],
    disclosure: '目录中 550ml 与 1.5L 是两条独立真实商品记录，此处聚合为同一商品的容量变体轴（演示交互）。',
    axes: [
      {
        id: 'size',
        name: '容量',
        kind: 'spec',
        options: [
          { id: '550', label: '550ml' },
          { id: '1500', label: '1.5L' },
        ],
      },
    ],
    combos: {
      '550': { price: 1.66, order: 27, productName: '农夫山泉矿泉水', specText: '550ml', available: true },
      '1500': { price: 2.88, order: 24, productName: '农夫山泉矿泉水', specText: '1.5L', available: true },
    },
  },
  {
    id: 'yibao-water',
    title: '怡宝矿泉水 · 容量',
    memberOrders: [25, 29],
    disclosure: '目录中 550ml 与 2.08L 是两条独立真实商品记录，此处聚合为同一商品的容量变体轴（演示交互）。',
    axes: [
      {
        id: 'size',
        name: '容量',
        kind: 'spec',
        options: [
          { id: '550', label: '550ml' },
          { id: '2080', label: '2.08L' },
        ],
      },
    ],
    combos: {
      '550': { price: 1.66, order: 29, productName: '怡宝矿泉水', specText: '550ml', available: true },
      '2080': { price: 3.66, order: 25, productName: '怡宝矿泉水', specText: '2.08L', available: true },
    },
  },
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
