import type { ReactNode } from 'react'
import { IconEmpty } from './Icons'

interface EmptyStateProps {
  /** 主文案（必填，统一 6 处各自实现的空态） */
  title: string
  /** 补充说明 */
  description?: string
  /** 自定义图标；默认使用通用空态图标（如需商品类可传 <IconCart />） */
  icon?: ReactNode
  /** 行动按钮等 */
  action?: ReactNode
  className?: string
}

/**
 * 统一空状态。
 * 无障碍：容器带 role="status"，读屏会在内容出现时播报「暂无数据」这类信息
 * （此前 6 处空态都是裸 div，读屏完全无感知）。
 */
export default function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}>
      <span className="w-12 h-12 rounded-2xl bg-gray-50 text-gray-300 flex items-center justify-center mb-3">
        {icon ?? <IconEmpty className="w-6 h-6" />}
      </span>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {description ? <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-xs">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
