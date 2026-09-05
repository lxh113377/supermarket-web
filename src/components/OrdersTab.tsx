import React, { useState, useMemo } from 'react'
import { updateOrderStatus, deleteOrder } from '../auth'
import { getAllOrders } from '../db'
import { buildCsvText } from '../utils/csv'
import type { Order } from '../types'

export default function OrdersTab({ orders, onOrdersChange, loading = false }: {
  orders: Order[]
  onOrdersChange: (orders: Order[]) => void
  loading?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [deleting, setDeleting] = useState<string | null>(null)
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
      await updateOrderStatus(orderId, status)
      // 状态变更后拉增量即可（更新后的订单 updatedAt 必然大于游标）
      const { orders } = await getAllOrders()
      onOrdersChange(orders)
    } catch (err) {
      alert('更新失败：' + (err instanceof Error ? err.message : '未知错误'))
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
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : '未知错误'))
    } finally {
      setDeleting(null)
    }
  }

  const copyOrder = (order: Order) => {
    const total = (order.totalAmount ?? 0).toFixed(2)
    const text = `房间号：${order.roomNumber}\n${order.items.map(i => i.name + (i.spec ? '(' + i.spec + ')' : '') + ' x' + i.quantity + ' ¥' + ((i.price ?? 0) * i.quantity).toFixed(2)).join('\n')}\n合计：¥${total}\n状态：${order.status === 'pending' ? '待支付' : order.status === 'paid' ? '已支付' : '已取消'}`
    navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板'))
  }

  const exportCSV = (): void => {
    const statusLabel = (s: string) => s === 'pending' ? '待支付' : s === 'paid' ? '已支付' : '已取消'
    const rows = orders.flatMap(o =>
      o.items.map(i => [
        String(o.roomNumber),
        `${i.name}${i.spec ? '(' + i.spec + ')' : ''}  x${i.quantity}`,
        String(i.quantity),
        (i.price ?? 0).toFixed(2),
        ((i.price ?? 0) * i.quantity).toFixed(2),
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
    a.click()
    URL.revokeObjectURL(url)
  }

  if (orders.length === 0 && loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <span className="text-sm text-gray-400">加载订单中...</span>
      </div>
    )
  }

  if (orders.length === 0) return <div className="text-center text-gray-400 py-10">暂无订单（需开启匿名登录）</div>

  return (
    <div className="space-y-3">
      <div className="flex gap-2 mb-2 flex-wrap">
        <input type="text" placeholder="搜索房间号…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-sm">
          <option value="all">全部</option>
          <option value="pending">待支付</option>
          <option value="paid">已支付</option>
          <option value="cancelled">已取消</option>
        </select>
        <button onClick={exportCSV} className="px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-600">CSV</button>
      </div>
      {visible.map(order => (
        <div key={order._id} className="bg-white p-3 rounded-lg border border-gray-100">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-bold">房间号：{order.roomNumber}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => copyOrder(order)} className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded">复制</button>
              <span className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="text-sm text-gray-600 mb-2">
            {order.items.map(item => item.name + (item.spec ? '(' + item.spec + ')' : '') + 'x' + item.quantity).join('，')}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-brand-600 font-bold">¥{(order.totalAmount ?? 0).toFixed(2)}</span>
            <div className="flex items-center gap-2">
              <select value={order.status} onChange={(e) => handleStatus(order._id, e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1">
                <option value="pending">待支付</option>
                <option value="paid">已支付</option>
                <option value="cancelled">已取消</option>
              </select>
              <button
                onClick={() => handleDelete(order._id)}
                disabled={deleting === order._id}
                aria-label="删除订单"
                className="text-xs text-red-400 hover:text-red-600 px-2 py-1 disabled:opacity-50"
              >
                {deleting === order._id ? '删除中' : '🗑'}
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
