import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { updateProduct, deleteProduct, batchUpdateProducts, batchDeleteProducts } from '../auth'
import type { Category, Product } from '../types'
import InlineEditForm from './admin/ProductInlineEditForm'
import ProductRow from './admin/ProductRow'
import EmptyState from './EmptyState'
import { IconBox, IconEmpty } from './Icons'
import { formatPrice } from '../utils/format'

// 管理后台商品 Tab（2026-09-23 拆分：408 行 → 主壳 ~200 行）
// 拆分出的子件：admin/ProductInlineEditForm（内联编辑表单）、admin/ProductRow（商品行）
// ⚠️ 交互范式铁律：编辑 = 该条目正下方内联展开，禁弹窗 / 抽屉 / 底部固定面板。

export default function ProductsTab({ products, categories, onDataChange }: {
  products: Product[]
  categories: Category[]
  onDataChange: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null) // null | 'new' | product._id
  const [batchPrice, setBatchPrice] = useState('')
  // 内联反馈条（替代原生 alert；confirm 确认语义保留）
  const [notice, setNotice] = useState<{ type: 'error' | 'warn'; msg: string } | null>(null)

  // notice 定时器可清理：原实现每次 showNotice 直接 setTimeout，卸载后仍会 setState
  const noticeTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const showNotice = useCallback((type: 'error' | 'warn', msg: string) => {
    setNotice({ type, msg })
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000)
  }, [])

  // 子分类 → { 所属分类 type, 展示名 } 一次预建索引。
  // 原实现：筛选时对每个商品遍历分类；行内标签对每个子分类做嵌套 find（商品 50+ 时明显浪费）。
  const subIndex = useMemo(() => {
    const map: Record<string, { type: string; name: string }> = {}
    categories.forEach(cat => cat.subcategories.forEach(sub => {
      map[sub.id] = { type: cat.type, name: sub.name }
    }))
    return map
  }, [categories])

  const filtered = useMemo(() => {
    let list = products
    if (filterCat) {
      list = list.filter(p => (p.subcategories || []).some(s => subIndex[s]?.type === filterCat))
    }
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(kw) || (p.spec || '').toLowerCase().includes(kw))
    }
    return list
  }, [products, filterCat, search, subIndex])

  /** 行内分类标签：O(1) 查表，不再嵌套 find */
  const catLabelOf = useCallback((product: Product) => (
    (product.subcategories || [])
      .map(s => subIndex[s]?.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ')
  ), [subIndex])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAllFiltered = () => {
    setSelectedIds(prev => (prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p._id))))
  }

  const quickToggle = useCallback(async (product: Product) => {
    try {
      await updateProduct(product._id, { enabled: product.enabled === false })
      onDataChange()
    } catch (err) { showNotice('error', '操作失败：' + (err instanceof Error ? err.message : '未知错误')) }
  }, [onDataChange, showNotice])

  const remove = useCallback(async (productId: string) => {
    if (!confirm('确定删除该商品？')) return
    try { await deleteProduct(productId); onDataChange() }
    catch (err) { showNotice('error', '删除失败：' + (err instanceof Error ? err.message : '未知错误')) }
  }, [onDataChange, showNotice])

  const toggleEdit = useCallback((id: string | null) => setEditingId(id), [])

  const batchAction = async (action: string) => {
    const ids = [...selectedIds]
    const count = ids.length
    if (!count) return
    if (action === 'delete' && !confirm(`确定删除 ${count} 个商品？`)) return
    const label = action === 'enable' ? '上架' : action === 'disable' ? '下架' : '删除'
    try {
      const result = action === 'delete'
        ? await batchDeleteProducts(ids)
        : await batchUpdateProducts(ids.map(id => ({ productId: id, updates: { enabled: action === 'enable' } })))
      const failed = result && 'data' in result && Array.isArray(result.data?.failed) ? result.data.failed : []
      if (result && 'code' in result && result.code !== 0) {
        alert(`批量${label}失败：` + (result.message || '未知错误'))
        return
      }
      setSelectedIds(new Set())
      onDataChange()
      if (failed.length) alert(`批量${label}部分失败：${failed.length}/${count} 未生效`)
    } catch (err) { alert(`批量${label}失败：` + (err instanceof Error ? err.message : '未知错误')) }
  }

  const batchAdjustPrice = async () => {
    const ids = [...selectedIds]
    if (!batchPrice.trim() || !ids.length) return
    const isPercent = batchPrice.includes('%')
    const val = parseFloat(batchPrice)
    if (isNaN(val)) return showNotice('error', '请输入有效数字')
    const label = isPercent ? `调整为原价的 ${val}%` : `统一设为 ¥${formatPrice(val)}`
    if (!confirm(`${ids.length} 个商品${label}？`)) return
    try {
      const items = ids.map(id => {
        const p = products.find(x => x._id === id)
        const newPrice = p ? (isPercent ? Math.round(p.price * val) / 100 : val) : val
        return { productId: id, updates: { price: Math.round(newPrice * 100) / 100 } }
      })
      const result = await batchUpdateProducts(items)
      const failed = result && 'data' in result && Array.isArray(result.data?.failed) ? result.data.failed : []
      if (result && 'code' in result && result.code !== 0) {
        showNotice('error', '批量改价失败：' + (result.message || '未知错误'))
        return
      }
      setBatchPrice('')
      setSelectedIds(new Set())
      onDataChange()
      if (failed.length) showNotice('warn', `批量改价部分失败：${failed.length}/${ids.length} 未生效`)
    } catch (err) { showNotice('error', '批量改价失败：' + (err instanceof Error ? err.message : '未知错误')) }
  }

  return (
    <div className="space-y-3">
      <div role="alert" aria-live="polite">
        {notice && (
          <div className={`px-3 py-2.5 rounded-xl text-xs border ${
            notice.type === 'error'
              ? 'bg-red-50 text-red-500 border-red-100'
              : 'bg-amber-50 text-amber-600 border-amber-100'
          }`}>
            {notice.msg}
          </div>
        )}
      </div>

      {/* 搜索 + 新增 */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="search"
            aria-label="搜索商品名称或规格"
            placeholder="搜索商品名称/规格..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden="true">🔍</span>
        </div>
        <button onClick={() => setEditingId('new')} className="px-4 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition shrink-0">+ 新增</button>
      </div>

      {/* 新增表单（内联在列表顶部，非弹窗） */}
      {editingId === 'new' && (
        <InlineEditForm
          product={{}}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); onDataChange() }}
        />
      )}

      {/* 分类筛选 */}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="按分类筛选">
        {[{ id: '', label: '全部' }, ...categories.map(c => ({ id: c.type, label: c.name }))].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterCat(f.id)}
            aria-pressed={filterCat === f.id}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterCat === f.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f.label}
          </button>
        ))}
        <button onClick={selectAllFiltered} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition">
          {filtered.length > 0 && selectedIds.size === filtered.length ? '取消全选' : `全选(${filtered.length})`}
        </button>
      </div>

      {/* 商品列表 */}
      {filtered.length === 0 && (
        <EmptyState
          icon={products.length === 0 ? <IconBox className="w-6 h-6" /> : <IconEmpty className="w-6 h-6" />}
          title={products.length === 0 ? '暂无商品' : '无匹配结果'}
          description={products.length === 0 ? '需先初始化种子数据，或点右上角「+ 新增」手动添加' : '试试换个关键词，或清空筛选条件'}
        />
      )}

      <div className="space-y-1.5">
        {filtered.map(product => (
          <ProductRow
            key={product._id}
            product={product}
            catLabel={catLabelOf(product)}
            isEditing={editingId === product._id}
            selected={selectedIds.has(product._id)}
            categories={categories}
            onToggleSelect={toggleSelect}
            onToggleEdit={toggleEdit}
            onQuickToggle={quickToggle}
            onRemove={remove}
            onSaved={onDataChange}
          />
        ))}
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30 shadow-lg safe-bottom">
          <div className="max-w-lg mx-auto space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0" aria-live="polite">已选 {selectedIds.size} 项</span>
              <div className="flex-1 flex gap-1.5">
                <button onClick={() => batchAction('enable')} className="flex-1 py-2 bg-green-500 text-white rounded-lg text-xs font-medium">上架</button>
                <button onClick={() => batchAction('disable')} className="flex-1 py-2 bg-gray-500 text-white rounded-lg text-xs font-medium">下架</button>
                <button onClick={() => batchAction('delete')} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-medium">删除</button>
                <button onClick={() => setSelectedIds(new Set())} aria-label="取消选择" className="tap-44 px-3 py-2 text-gray-400 text-xs">✕</button>
              </div>
            </div>
            <div className="flex gap-1.5">
              <input
                aria-label="批量改价：数字表示统一价，数字加百分号表示打折"
                placeholder="批量改价：数字=统一价 / 数字%=打折"
                value={batchPrice}
                onChange={e => setBatchPrice(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
              />
              <button onClick={batchAdjustPrice} className="px-3 py-1.5 bg-brand-500 text-white rounded-lg text-xs font-medium">应用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
