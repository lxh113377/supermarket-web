// 服务配置 - 定义所有分类和子服务的表单结构
import type { Service, ServiceCategory } from '../types'
import { CATEGORIES } from './categories'

// CATEGORIES 定义已迁至 ./categories（轻量模块），此处 re-export 保持既有导入路径可用。
// HomePage 等只用到分类的页面请直接从 '../data/categories' 引入，避免连带加载本文件的服务定义。
export { CATEGORIES }

export const SERVICES: Service[] = [
  // ===== 生活 =====
  {
    id: 'snacks',
    categoryId: 'life',
    name: '零食饮料',
    icon: '🍜',
    description: '超市零食饮料配送',
    type: 'supermarket', // 特殊类型，跳转现有超市页面
  },
  {
    id: 'delivery',
    categoryId: 'life',
    name: '外卖帮拿',
    icon: '🥡',
    description: '帮你取外卖送到宿舍',
    type: 'form',
    popup: '请在配送员与您电话联系，表示可正常配送后，再进行美团、淘宝、京东下单',
    fields: [
      { key: 'phone', label: '电话号', type: 'tel', required: true, placeholder: '请输入你的手机号' },
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '配送楼栋', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'screenshot', label: '订单截图（选填）', type: 'image', required: false, hint: '截图需包含订单号、取餐地点（取餐地点仅限江西科技学院南北东门）' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'express',
    categoryId: 'life',
    name: '快递代拿',
    icon: '📦',
    description: '帮你取快递送到宿舍',
    type: 'form',
    hint: '十斤以下小件1.5元，十斤以上大件3元，50斤特大件另算',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '楼栋号', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'screenshot', label: '订单截图', type: 'image', required: true, minCount: 1, hint: '请上传快递订单截图，需包含取件信息' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'shoes',
    categoryId: 'life',
    name: '洗鞋拿送',
    icon: '👟',
    description: '专业洗鞋，上门取送',
    type: 'form',
    hint: '洗鞋晾干送回\n价值超800元的鞋不洗\n只水洗不干洗\n洗坏赔付购买价格30%\n洗一次每双8.88元+配送费5元\n\n(配套服务)\n清新除臭除菌Ag+\n温和羊油鞋油保养\n免费晾干送回',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '楼栋号', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'housekeeping',
    categoryId: 'life',
    name: '宿舍家政',
    icon: '🧹',
    description: '宿舍打扫清洁服务',
    type: 'form',
    popup: '目前仅支持男寝节假日打扫',
    hint: '扫+拖10元(2.5元/人)\n厕所+浴室12元(3元/人)附赠厕所除臭\n过脏额外收费 (视情况而定)',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '楼栋号', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'campus-card',
    categoryId: 'life',
    name: '办校园卡',
    icon: '💳',
    description: '帮你办理校园卡',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '楼栋号', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'gym',
    categoryId: 'life',
    name: '办健身房',
    icon: '🏋️',
    description: '帮你办理健身房会员',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'building', label: '楼栋号', type: 'text', required: true, placeholder: '例如：36栋' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'medical-consult',
    categoryId: 'life',
    name: '生病问政',
    icon: '🩺',
    description: '专业医生线上问诊',
    type: 'form',
    hint: '站长的老冯是专业医生👨‍⚕️，从医20余年，线上问诊3元一次',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '症状描述', type: 'text', required: false, placeholder: '选填，简述症状方便医生提前了解' },
    ],
  },
  // ===== 娱乐 =====
  {
    id: 'gaming',
    categoryId: 'entertainment',
    name: '游戏陪玩',
    icon: '🎮',
    description: '江科打手，出问题包解决，可溯源',
    type: 'form',
    hint: '江科打手，出问题包解决，可溯源',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'pc-build',
    categoryId: 'entertainment',
    name: '电脑装机',
    icon: '💻',
    description: '专业装机，经验丰富',
    type: 'form',
    hint: '装机师傅知识经验丰富，装机经验50+',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'recycle',
    categoryId: 'entertainment',
    name: '回收数码',
    icon: '♻️',
    description: '高价回收数码产品',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  // ===== 学习 =====
  {
    id: 'course',
    categoryId: 'study',
    name: '代刷课',
    icon: '🖥️',
    description: '网课代刷，安全高效',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'running',
    categoryId: 'study',
    name: '代乐跑',
    icon: '🏃',
    description: '乐跑代跑，轻松搞定',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'homework',
    categoryId: 'study',
    name: '代作业',
    icon: '📝',
    description: '作业代写，质量保证',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  // ===== 其他 =====
  {
    id: 'cooperate',
    categoryId: 'other',
    name: '我想合作',
    icon: '🤝',
    description: '商务合作洽谈',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
  {
    id: 'advertise',
    categoryId: 'other',
    name: '我想打广告',
    icon: '📢',
    description: '广告投放合作',
    type: 'form',
    fields: [
      { key: 'wechat', label: '微信号', type: 'text', required: true, placeholder: '请输入你的微信号' },
      { key: 'remark', label: '备注', type: 'text', required: false, placeholder: '选填，有其他需求可以写在这里' },
    ],
  },
]

export function getServicesByCategory(categoryId: string): Service[] {
  return SERVICES.filter(s => s.categoryId === categoryId)
}

export function getServiceById(serviceId: string): Service | undefined {
  return SERVICES.find(s => s.id === serviceId)
}

export function getCategoryById(categoryId: string): ServiceCategory | undefined {
  return CATEGORIES.find(c => c.id === categoryId)
}
