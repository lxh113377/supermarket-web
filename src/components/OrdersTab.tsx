import {  useState, useMemo  } from 'react'
import { updateOrderStatus, deleteOrder } from '../auth'
import { getAllOrders } from '../db'
import { buildCsvText } from '../utils/csv'
import EmptyState from './EmptyState'
import { SkeletonTable } from './Skeleton'
import { IconEmpty } from './Icons'
import { formatPrice, formatYuan } from '../utils/format'
import { orderStatusLabel, nextOrderStatuses, ORDER_STATUS_LABELS } from '../utils/orderStatus'
import type { Order } from '../types'

export default function OrdersTab({ orders, onOrdersChange, loading = false }: {
  orders: Order[]
  onOrdersChange: (orders: Order[]) => void
  loading?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  // P0-4 分页：订单全量渲染在数据量大时卡顿，按页渲染
  const PAGE_SIZE = 20
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let list = orders
    if (filter !== 'all') list = list.filter(o => o.status === filter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(o => String(o.roomNumber || '').toLowerCase().includes(q))
    }
    return list
  }, [orders, filter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageOf = (p: number) => Math.min(Math.max(1, p), totalPages)

  const handleStatus = async (orderId: string, status: string) => {
    try {
      const res = await updateOrderStatus(orderId, status)
      if (res && 'code' in res && res.code !== 0) throw new Error(res.message || '更新失败')
      setNotice(`订单状态已更新为「${orderStatusLabel(status)}」`)
      // 状态变更后拉增量即可（更新后的订单 updatedAt 必然大于游标）
      const { orders } = await getAllOrders()
      onOrdersChange(orders)
    } catch (err) {
      setNotice('更新失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handleDelete = async (orderId: string) => {
    if (!confirm('确定删除该订单？此操作不可撤销。')) return
    setDeleting(orderId)
    try {
      const res = await deleteOrder(orderId)
      if (!res || ('code' in res && res.code !== 0)) {
        throw new Error((res && 'message' in res && res.message) || '删除失败')
      }
      const { orders } = await getAllOrders()
      onOrdersChange(orders)
      setNotice('订单已删除')
    } catch (err) {
      setNotice('删除失败：' + (err instanceof Error ? err.message : '未知错误'))
    } finally {
      setDeleting(null)
    }
  }

  const copyOrder = (order: Order) => {
    const text = `房间号：${order.roomNumber}\n${order.items.map(i => i.name + (i.spec ? '(' + i.spec + ')' : '') + ' x' + i.quantity + ' ¥' + formatPrice((i.price ?? 0) * i.quantity)).join('\n')}\n合计：${formatYuan(order.totalAmount ?? 0)}\n状态：${orderStatusLabel(order.status)}`
    navigator.clipboard.writeText(text).then(() => setNotice('已复制到剪贴板'))
  }

  const exportCSV = (): void => {
    const statusLabel = orderStatusLabel
    const rows = orders.flatMap(o =>
      o.items.map(i => [
        String(o.roomNumber),
        `${i.name}${i.spec ? '(' + i.spec + ')' : ''}  x${i.quantity}`,
        String(i.quantity),
        formatPrice(i.price ?? 0),
        formatPrice((i.price ?? 0) * i.quantity),
        statusLabel(o.status),
        new Date(o.createdAt).toLocaleString(),
      ])
    )
    const csv = buildCsvText(['房间号', '商品', '数量', '单价', '小计', '状态', '时间'], rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`
    // 必须先挂进 DOM 再点击：Firefox 对游离节点不触发下载（Chrome/Safari 不校验）
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 延迟释放：Safari 在 click 返回后仍会读该 URL，立即 revoke 会导致下载空文件
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (orders.length === 0 && loading) {
    return (
      <div className="space-y-3">
        <span className="sr-only" role="status">加载订单中</span>
        <SkeletonTable rows={5} />
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<IconEmpty className="w-6 h-6" />}
        title="暂无订单"
        description="还没有顾客下单，或当前账号未开启匿名登录"
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input
          type="search"
          aria-label="按房间号搜索订单"
          placeholder="搜索房间号…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 min-w-[8rem] border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <select
          aria-label="按订单状态筛选"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(1) }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-sm"
        >
          <option value="all">全部</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button onClick={exportCSV} className="px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-600">CSV</button>
      </div>
      {notice && (
        <p role="status" aria-live="polite" className="text-xs text-gray-600 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>
      )}
      {visible.map(order => (
        <div key={order._id} className="bg-white p-3 rounded-lg border border-gray-100">
          <div className="flex justify-between items-start gap-2 mb-2">
            <span className="text-sm font-bold min-w-0 truncate">房间号：{order.roomNumber}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => copyOrder(order)} className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded">复制</button>
              <span className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="text-sm text-gray-600 mb-2">
            {order.items.map(item => item.name + (item.spec ? '(' + item.spec + ')' : '') + 'x' + item.quantity).join('，')}
          </div>
          {/* 管理端行内布局：手机端纵向堆叠，sm 以上左右分列（原实现挤在一行、金额与操作互相挤压） */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <span className="text-brand-600 font-bold">{formatYuan(order.totalAmount ?? 0)}</span>
            <div className="flex items-center gap-2">
              <select
                aria-label={`订单 ${order.roomNumber} 的状态`}
                value={order.status}
                onChange={(e) => handleStatus(order._id, e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1"
              >
                {nextOrderStatuses(order.status).map((s) => (
                  <option key={s} value={s}>{orderStatusLabel(s)}</option>
                ))}
              </select>
              <button
                onClick={() => handleDelete(order._id)}
                disabled={deleting === order._id}
                aria-label="删除订单"
                className="tap-44 text-xs text-red-400 hover:text-red-600 px-2 py-1 disabled:opacity-50"
              >
                {deleting === order._id ? '删除中' : <span aria-hidden="true">🗑</span>}
              </button>
            </div>
          </div>
        </div>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1 text-sm">
          <span className="text-xs text-gray-400">共 {filtered.length} 单 · 第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => pageOf(p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 disabled:opacity-40"
            >上一页</button>
            <button
              onClick={() => setPage((p) => pageOf(p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 disabled:opacity-40"
            >下一页</button>
          </div>
        </div>
      )}
    </div>
  )
}
