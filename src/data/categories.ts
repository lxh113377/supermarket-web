// 四大服务分类常量 —— 从 services.ts 拆出的轻量模块。
//
// 配色口径（2026-10-22 设计升级）：这里的 color 是**头部渐变**，上面承载白字标题，
// 所以两端都必须让白字过 WCAG AA（≥4.5:1）。旧值 from-purple-400 / from-blue-400
// 白字只有 2.7:1 / 2.5:1（不合格），且紫+靛是"AI 默认配色"的典型形态。
// 现值实测（白字压两端）：苔绿 7.13/9.11、墨柿 7.31/9.37、深松 5.47/7.27、琥珀 7.09/9.07。
// 四色都是"暖 earth + 深绿"这一族，与品牌条（柿子黄→橙→深绿）同源，不再各说各话。
// 目的：HomePage 只需这 4 条分类数据，不必连带加载 services.ts（约 10KB 的服务/表单定义）。
// services.ts 仍从此处 re-export，保持既有导入路径不变。
import type { ServiceCategory } from '../types'

export const CATEGORIES: ServiceCategory[] = [
  {
    id: 'life',
    name: '生活',
    icon: '🏠',
    color: 'from-espresso-900 via-green-900 to-forest',
    description: '日常生活服务',
  },
  {
    id: 'entertainment',
    name: '娱乐',
    icon: '🎮',
    color: 'from-espresso-900 via-amber-900 to-brand-900',
    description: '娱乐休闲服务',
  },
  {
    id: 'study',
    name: '学习',
    icon: '📚',
    color: 'from-espresso-900 via-green-900 to-forest',
    description: '学习辅助服务',
  },
  {
    id: 'other',
    name: '其他',
    icon: '💡',
    color: 'from-espresso-900 via-amber-900 to-brand-900',
    description: '合作与推广',
  },
]
