// 订单状态机前端单源（与 functions/lib/actions/orders.js 的 ORDER_TRANSITIONS 同构，
// 云端强制在服务端，本地演示模式在此强制；两处取值域必须一致）
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  delivering: '配送中',
  completed: '已送达',
  cancelled: '已取消',
}

// 履约主链（看板/进度条展示顺序）；cancelled 为旁路终态
export const ORDER_FLOW: string[] = ['pending', 'paid', 'delivering', 'completed']

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['delivering', 'cancelled'],
  delivering: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['pending'],
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] || status
}

export function canTransitionOrder(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] || []).includes(to)
}

// 管理端每行可选状态 = 当前状态 + 合法迁移目标
export function nextOrderStatuses(from: string): string[] {
  return [from, ...(ORDER_TRANSITIONS[from] || [])]
}
