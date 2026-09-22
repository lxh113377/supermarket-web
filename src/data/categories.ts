// 四大服务分类常量 —— 从 services.ts 拆出的轻量模块。
// 目的：HomePage 只需这 4 条分类数据，不必连带加载 services.ts（约 10KB 的服务/表单定义）。
// services.ts 仍从此处 re-export，保持既有导入路径不变。
import type { ServiceCategory } from '../types'

export const CATEGORIES: ServiceCategory[] = [
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
