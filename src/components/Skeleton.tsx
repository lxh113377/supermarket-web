// 骨架屏基础件 —— 全站唯一实现。
// 此前只有 CustomerPage 有局部 SkeletonCard，OrdersTab / ReviewsTab / ProductsTab
// 加载期是纯空白。统一到这里后各处只需组合。

interface SkeletonProps {
  className?: string
}

/** 单个色块（配合 Tailwind 尺寸类使用） */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton-shimmer ${className}`} />
}

/** 列表行骨架：左两行文本 + 右侧圆形按钮位（商品列表 / 订单列表通用） */
export function SkeletonRow({ className = '' }: SkeletonProps) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-2xl bg-white border border-gray-100/80 ${className}`}>
      <div className="flex-1 pr-3 space-y-2.5">
        <Skeleton className="h-4 w-3/4 rounded-md" />
        <Skeleton className="h-3.5 w-1/4 rounded-md" />
      </div>
      <Skeleton className="w-8 h-8 rounded-full" />
    </div>
  )
}

/** 列表骨架组：默认 6 行 */
export function SkeletonList({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="内容加载中">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
      <span className="sr-only">内容加载中</span>
    </div>
  )
}

/** 表格/卡片看板骨架：一列 N 行（管理端各 Tab 使用） */
export function SkeletonTable({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-label="内容加载中">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
      <span className="sr-only">内容加载中</span>
    </div>
  )
}
