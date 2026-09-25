// 初始商品数据，从 小程序.txt 解析
import type { Category, SeedProduct } from '../types'

export const categories: Category[] = [
  {
    _id: 'drinks',
    name: '饮品',
    type: 'drink',
    order: 1,
    subcategories: [
      { id: 'low_sugar', name: '无/低糖', order: 1 },
      { id: 'vitamin', name: '维生素', order: 2 },
      { id: 'energy', name: '提神', order: 3 },
      { id: 'tea', name: '茶', order: 4 },
      { id: 'soda', name: '碳酸', order: 5 },
      { id: 'sweet', name: '甜口', order: 6 },
      { id: 'water', name: '矿泉水', order: 7 },
    ],
  },
  {
    _id: 'food',
    name: '食品',
    type: 'food',
    order: 2,
    subcategories: [
      { id: 'snacks', name: '零食', order: 1 },
      { id: 'filling', name: '垫腹', order: 2 },
    ],
  },
]

export const products: SeedProduct[] = [
  // 甜口
  { name: '康师傅冰糖雪梨', spec: '1L', price: 2.66, subcategories: ['sweet'], order: 1 },
  { name: '康师傅青梅绿茶', spec: '1L', price: 2.66, subcategories: ['sweet'], order: 2 },
  { name: '康师傅金桔柠檬', spec: '1L', price: 2.66, subcategories: ['sweet'], order: 3 },
  { name: '康师傅冰糖红西柚', spec: '1L', price: 3.66, subcategories: ['sweet'], order: 4 },

  // 茶
  { name: '康师傅绿茶', spec: '1L', price: 3.66, subcategories: ['tea'], order: 5 },
  { name: '康师傅冰红茶', spec: '1L', price: 3.66, subcategories: ['tea'], order: 6 },
  { name: '和其正凉茶', spec: '1L', price: 3.66, subcategories: ['tea'], order: 7 },
  { name: '东方树叶青柑普洱', spec: '900ml', price: 5.66, subcategories: ['tea'], order: 8 },
  { name: '茶π', spec: '500ml', price: 3.66, subcategories: ['tea'], order: 9 },
  { name: '统一阿萨姆奶茶', spec: '', price: 4.66, subcategories: ['tea'], order: 10 },

  // 无/低糖
  { name: '0糖康师傅茉莉龙井', spec: '500ml', price: 1.88, subcategories: ['low_sugar', 'tea'], order: 11 },
  { name: '0糖康师傅茉莉花茶', spec: '500ml', price: 1.88, subcategories: ['low_sugar', 'tea'], order: 12 },
  { name: '低糖元气森林冰茶', spec: '900ml', price: 4.66, subcategories: ['low_sugar'], order: 13 },

  // 维生素
  { name: '水溶c100', spec: '', price: 4.66, subcategories: ['vitamin'], order: 14 },
  { name: '维他命', spec: '农夫山泉500ml', price: 3.88, subcategories: ['vitamin'], order: 15 },

  // 提神
  { name: '盒装东鹏特饮', spec: '250ml', price: 2.33, subcategories: ['energy'], order: 16 },
  { name: '瓶装东鹏特饮', spec: '250ml', price: 2.66, subcategories: ['energy'], order: 17 },
  { name: '东鹏特饮', spec: '500ml', price: 4.66, subcategories: ['energy'], order: 18 },
  { name: '罐装魔爪', spec: '330ml', price: 3.88, subcategories: ['energy'], order: 19 },
  { name: '猎兽功能饮料', spec: '500ml', price: 2.33, subcategories: ['energy'], order: 20 },
  { name: '外星人补水电解质专业版', spec: '500ml', price: 3.66, subcategories: ['energy'], order: 21 },

  // 碳酸
  { name: '有糖可乐', spec: '罐装330ml', price: 2.66, subcategories: ['soda'], order: 22 },

  // 矿泉水
  { name: '景田饮用水', spec: '1.5L', price: 2.66, subcategories: ['water'], order: 23 },
  { name: '农夫山泉矿泉水', spec: '1.5L', price: 2.88, subcategories: ['water'], order: 24 },
  { name: '怡宝矿泉水', spec: '2.08L', price: 3.66, subcategories: ['water'], order: 25 },
  { name: '冰露饮用水', spec: '550ml', price: 0.88, subcategories: ['water'], order: 26 },
  { name: '农夫山泉矿泉水', spec: '550ml', price: 1.66, subcategories: ['water'], order: 27 },
  { name: '哇哈哈矿泉水', spec: '550ml', price: 1.66, subcategories: ['water'], order: 28 },
  { name: '怡宝矿泉水', spec: '550ml', price: 1.66, subcategories: ['water'], order: 29 },
  { name: '百岁山矿泉水', spec: '570ml', price: 2.11, subcategories: ['water'], order: 30 },

  // 零食
  { name: '熊博士软糖', spec: '22g', price: 0.8, subcategories: ['snacks'], order: 31 },
  { name: '士力架', spec: '两条装', price: 4.88, subcategories: ['snacks'], order: 32 },
  // 可选口味（specOptions）见 order 33/34/40/52 四款：清单 2026-09-25 网查整理（京东/
  // 什么值得买/百度知道在售包装标注），同小包共用单价与实拍图；本店没进的口味由管理后台开关关掉即可。
  {
    name: '乐事薯片', spec: '40g', price: 2.66, subcategories: ['snacks'], order: 33,
    specOptions: [
      { label: '原味' }, { label: '黄瓜味' }, { label: '青柠味' }, { label: '番茄味' },
      { label: '墨西哥鸡汁番茄味' }, { label: '意大利香浓红烩味' }, { label: '得克萨斯烧烤味' }, { label: '烤虾味' },
    ],
  },
  {
    name: '呀土豆薯条', spec: '40g', price: 2.66, subcategories: ['snacks'], order: 34,
    specOptions: [
      { label: '里脊牛排味' }, { label: '芝士培根味' }, { label: '番茄酱味' },
      { label: '滋香烤鸡味' }, { label: '麻辣小龙虾味' },
    ],
  },
  { name: '彩虹糖', spec: '30g', price: 3.88, subcategories: ['snacks'], order: 35 },
  { name: '好多鱼', spec: '', price: 2.66, subcategories: ['snacks'], order: 36 },
  { name: '旺旺小小酥', spec: '18g', price: 0.88, subcategories: ['snacks'], order: 37 },
  { name: '卫龙大面筋辣条', spec: '', price: 0.88, subcategories: ['snacks'], order: 38 },
  { name: '仔仔棒', spec: '', price: 0.08, subcategories: ['snacks'], order: 39 },
  {
    name: '好丽友好有趣薯片', spec: '40g', price: 2.66, subcategories: ['snacks'], order: 40,
    specOptions: [
      { label: '韩国泡菜味' }, { label: '多汁牛排味' }, { label: '蜂蜜黄油味' }, { label: '加勒比烤翅味' },
      { label: '火鸡面味' }, { label: '见手青味' }, { label: '香菜塔可味' },
    ],
  },
  { name: '光头娃一根葱', spec: '', price: 0.33, subcategories: ['snacks'], order: 41 },
  { name: '纳宝帝nabati威化饼干', spec: '16g', price: 0.33, subcategories: ['snacks'], order: 42 },
  { name: '脆脆鲨', spec: '', price: 0.88, subcategories: ['snacks'], order: 43 },
  { name: '山椒猪皮', spec: '', price: 0.33, subcategories: ['snacks'], order: 44 },
  { name: '乌梅干', spec: '', price: 2.33, subcategories: ['snacks'], order: 45 },

  // 垫腹
  { name: '白象方便面', spec: '帮泡+可选十三香/麻辣香/山西老陈醋', price: 3.66, subcategories: ['filling'], order: 46 },
  { name: '白象方便面', spec: '零售', price: 1.88, subcategories: ['filling'], order: 47 },
  { name: '乡巴佬卤蛋', spec: '', price: 1.37, subcategories: ['filling'], order: 48 },
  { name: '双汇火腿肠', spec: '', price: 0.88, subcategories: ['filling'], order: 49 },

  // 新增商品
  { name: '优酸乳', spec: '200ml', price: 1.5, subcategories: ['sweet'], order: 50 },
  { name: '补水啦', spec: '900ml', price: 4.88, subcategories: ['energy'], order: 51 },
  {
    name: '乐吧薯片', spec: '40g', price: 1.88, subcategories: ['snacks'], order: 52,
    specOptions: [
      { label: '海苔味' }, { label: '芥末味' }, { label: '鸡肉味' }, { label: '烧烤味' },
      { label: '番茄味' }, { label: '泡菜味' }, { label: '咖喱牛肉味' }, { label: '香洋葱味' },
    ],
  },

  // 新增商品（2026-09-07）
  { name: '康师傅茉莉清茶', spec: '1L', price: 3.5, subcategories: ['tea', 'sweet'], order: 53 },
  { name: '康师傅茉莉蜜茶', spec: '1L', price: 3.5, subcategories: ['tea', 'sweet'], order: 54 },
]
