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
  /** 台账序号（如 '01'）：给空态一个「记在哪一行」的身份，不给就只是一个通用占位 */
  index?: string
}

/**
 * 统一空状态 —— 站内语言是「底稿上的一处缺页标记」，不是通用灰方块 + 灰字。
 *
 * 2026-10-26 第 91 轮改造三处：
 *  ① 图标托从灰底灰图标（bg-gray-50 + text-stone-400，通用 AI 感）换成与柜台台账
 *     .counter-stage、详情页 .stage-frame **同一块暖台**（--t-stage + 铜发丝描边）——
 *     「空着」与「有货」共用一块台，读起来才是这个柜台暂时空，而不是这里坏了。
 *  ② 标题字色从次级（stone-500）提到 --t-ink：空态是要说清的一件事，不该比正文还弱；
 *     说明文字留在 mute 档 —— 层级靠对比，不靠一起变淡。
 *  ③ 补一条本站的分层金线（.hairline）与可选台账序号，让空态落在台账语境里，
 *     而不是浮在一片空白中央。
 *
 * 无障碍：容器带 role="status"，读屏会在内容出现时播报「暂无数据」这类信息
 * （此前 6 处空态都是裸 div，读屏完全无感知）。
 */
export default function EmptyState({ title, description, icon, action, className = '', index }: EmptyStateProps) {
  return (
    <div role="status" className={'flex flex-col items-center justify-center text-center px-6 py-12 ' + className}>
      {index ? <span aria-hidden="true" className="counter-no mb-2">{index}</span> : null}
      <span className="empty-stage mb-3">{icon ?? <IconEmpty className="w-6 h-6" />}</span>
      <p className="text-sm font-bold text-ink">{title}</p>
      {description ? <p className="text-xs leading-relaxed text-mute mt-1.5 max-w-xs">{description}</p> : null}
      <span aria-hidden="true" className="hairline mt-4 w-16" />
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
