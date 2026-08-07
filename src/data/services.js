// 服务配置 - 定义所有分类和子服务的表单结构
export const CATEGORIES = [
  {
    id: 'life',
    name: '生活',
    icon: '🏠',
    color: 'from-green-400 to-emerald-500',
    description: '日常生活服务',
  },
  {
    id: 'entertainment',
    name: '娱乐',
    icon: '🎮',
    color: 'from-purple-400 to-violet-500',
    description: '娱乐休闲服务',
  },
  {
    id: 'study',
    name: '学习',
    icon: '📚',
    color: 'from-blue-400 to-indigo-500',
    description: '学习辅助服务',
  },
  {
    id: 'other',
    name: '其他',
    icon: '💡',
    color: 'from-orange-400 to-amber-500',
    description: '合作与推广',
  },
]

export const SERVICES = [
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

export function getServicesByCategory(categoryId) {
  return SERVICES.filter(s => s.categoryId === categoryId)
}

export function getServiceById(serviceId) {
  return SERVICES.find(s => s.id === serviceId)
}

export function getCategoryById(categoryId) {
  return CATEGORIES.find(c => c.id === categoryId)
}
