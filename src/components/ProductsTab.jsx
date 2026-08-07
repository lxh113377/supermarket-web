import React, { useState, useMemo } from 'react'
import { updateProduct, createProduct, deleteProduct } from '../auth.js'

const emptyForm = { name: '', spec: '', price: 0, subcategories: [], enabled: true, image: '', description: '', reviews: [] }

// ---- 内联编辑表单 ----
function InlineEditForm({ product, categories, onClose, onSaved }) {
  const isNew = !product._id
  const [form, setForm] = useState(isNew ? { ...emptyForm } : {
    name: product.name,
    spec: product.spec || '',
    price: product.price,
    subcategories: product.subcategories || [],
    enabled: product.enabled !== false,
    image: product.image || '',
    description: product.description || '',
  })
  const [saving, setSaving] = useState(false)

  const toggleSub = (subId) => {
    const subs = form.subcategories.includes(subId)
      ? form.subcategories.filter(s => s !== subId)
      : [...form.subcategories, subId]
    setForm({ ...form, subcategories: subs })
  }

  const save = async () => {
    if (!form.name.trim()) return alert('商品名称不能为空')
    setSaving(true)
    try {
      const result = isNew ? await createProduct(form) : await updateProduct(product._id, form)
      if (result && result.code !== undefined && result.code !== 0) {
        alert('保存失败：' + (result.message || '未知错误'))
        return
      }
      onSaved()
    } catch (err) { alert('保存失败：' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="px-3 pb-3 pt-1 bg-brand-50/30 rounded-b-xl border border-t-0 border-brand-100 -mt-1.5">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="名称 *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-brand-400 outline-none" />
        <input placeholder="规格" value={form.spec} onChange={e => setForm({ ...form, spec: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-brand-400 outline-none" />
        <input type="number" step="0.01" placeholder="价格" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-brand-400 outline-none" />
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {categories.map(cat => cat.subcategories.map(sub => (
          <button key={sub.id} onClick={() => toggleSub(sub.id)}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${form.subcategories.includes(sub.id) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-200'}`}>
            {sub.name}
          </button>
        )))}
        <button onClick={() => setForm({ ...form, enabled: !form.enabled })}
          className={`px-2 py-0.5 rounded text-[11px] border transition ml-auto ${form.enabled ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-400 border-gray-200'}`}>
          {form.enabled ? '上架' : '下架'}
        </button>
      </div>
      <div className="flex gap-2 mt-2.5">
        <button onClick={save} disabled={saving} className="flex-1 py-2 bg-brand-500 text-white rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition">
          {saving ? '保存中...' : '保存'}
        </button>
        <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-500 rounded-lg text-xs hover:bg-gray-200 transition">取消</button>
      </div>
    </div>
  )
}

// ---- 主组件 ----
export default function ProductsTab({ products, categories, onDataChange }) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [editingId, setEditingId] = useState(null) // null | 'new' | product._id
  const [batchPrice, setBatchPrice] = useState('')

  const subToType = useMemo(() => {
    const map = {}
    categories.forEach(cat => cat.subcategories.forEach(sub => { map[sub.id] = cat.type }))
    return map
  }, [categories])

  const filtered = useMemo(() => {
    let list = products
    if (filterCat) {
      list = list.filter(p => (p.subcategories || []).some(s => subToType[s] === filterCat))
    }
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(kw) || (p.spec || '').toLowerCase().includes(kw))
    }
    return list
  }, [products, filterCat, search, subToType])

  const toggleSelect = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) { next.delete(id) } else { next.add(id) }
    setSelectedIds(next)
  }

  const selectAllFiltered = () => {
    setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(p => p._id)))
  }

  const quickToggle = async (product) => {
    try {
      await updateProduct(product._id, { enabled: product.enabled === false })
      onDataChange()
    } catch (err) { alert('操作失败：' + err.message) }
  }

  const remove = async (productId) => {
    if (!confirm('确定删除该商品？')) return
    try { await deleteProduct(productId); onDataChange() }
    catch (err) { alert('删除失败：' + err.message) }
  }

  const batchAction = async (action) => {
    const count = selectedIds.size
    if (!count) return
    if (action === 'delete' && !confirm(`确定删除 ${count} 个商品？`)) return
    const label = action === 'enable' ? '上架' : action === 'disable' ? '下架' : '删除'
    try {
      await Promise.all([...selectedIds].map(id =>
        action === 'delete' ? deleteProduct(id) : updateProduct(id, { enabled: action === 'enable' })
      ))
      setSelectedIds(new Set())
      onDataChange()
    } catch (err) { alert(`批量${label}失败：` + err.message) }
  }

  const batchAdjustPrice = async () => {
    if (!batchPrice.trim() || !selectedIds.size) return
    const isPercent = batchPrice.includes('%')
    const val = parseFloat(batchPrice)
    if (isNaN(val)) return alert('请输入有效数字')
    const label = isPercent ? `调整为原价的 ${val}%` : `统一设为 ¥${val.toFixed(2)}`
    if (!confirm(`${selectedIds.size} 个商品${label}？`)) return
    try {
      await Promise.all([...selectedIds].map(id => {
        const p = products.find(x => x._id === id)
        const newPrice = isPercent ? Math.round(p.price * val) / 100 : val
        return updateProduct(id, { price: Math.round(newPrice * 100) / 100 })
      }))
      setBatchPrice('')
      setSelectedIds(new Set())
      onDataChange()
    } catch (err) { alert('批量改价失败：' + err.message) }
  }

  return (
    <div className="space-y-3">
      {/* 搜索 + 新增 */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            placeholder="搜索商品名称/规格..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        </div>
        <button onClick={() => setEditingId('new')} className="px-4 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition shrink-0">+ 新增</button>
      </div>

      {/* 新增表单（内联在列表顶部） */}
      {editingId === 'new' && (
        <InlineEditForm
          product={{}}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); onDataChange() }}
        />
      )}

      {/* 分类筛选 */}
      <div className="flex gap-1.5">
        {[{ id: '', label: '全部' }, ...categories.map(c => ({ id: c.type, label: c.name }))].map(f => (
          <button key={f.id} onClick={() => setFilterCat(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterCat === f.id ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={selectAllFiltered} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition">
          {filtered.length > 0 && selectedIds.size === filtered.length ? '取消全选' : `全选(${filtered.length})`}
        </button>
      </div>

      {/* 商品列表 */}
      {filtered.length === 0 && (
        <div className="text-center text-gray-400 py-10 text-sm">
          {products.length === 0 ? '暂无商品（需先初始化种子数据）' : '无匹配结果'}
        </div>
      )}

      <div className="space-y-1.5">
        {filtered.map(product => {
          const imgSrc = product.image || (product.order ? `/images/${product.order}.webp` : null)
          const catLabel = (product.subcategories || []).map(s => {
            for (const cat of categories) {
              const sub = cat.subcategories.find(sb => sb.id === s)
              if (sub) return sub.name
            }
            return null
          }).filter(Boolean).slice(0, 2).join(' · ')
          const isEditing = editingId === product._id

          return (
            <div key={product._id}>
              <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isEditing ? 'border-brand-300 bg-brand-50/50 rounded-b-none' : selectedIds.has(product._id) ? 'border-brand-300 bg-brand-50/50' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                <input type="checkbox" checked={selectedIds.has(product._id)} onChange={() => toggleSelect(product._id)} className="w-4 h-4 accent-brand-500 shrink-0 rounded" />

                <div className="w-11 h-11 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 shrink-0">
                  {imgSrc ? (
                    <img src={imgSrc} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-red-300 text-[10px]">无图</div>
                  )}
                </div>

                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingId(isEditing ? null : product._id)}>
                  <p className={`text-sm font-medium truncate ${product.enabled === false ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {product.name}{product.spec ? ` (${product.spec})` : ''}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-brand-600 font-bold text-sm">¥{product.price.toFixed(2)}</span>
                    {catLabel && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{catLabel}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => quickToggle(product)}
                    title={product.enabled === false ? '点击上架' : '点击下架'}
                    className={`w-9 h-5 rounded-full transition-colors relative ${product.enabled !== false ? 'bg-green-400' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow transition-transform ${product.enabled !== false ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </button>
                  <button onClick={() => setEditingId(isEditing ? null : product._id)} className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs transition ${isEditing ? 'bg-brand-500 border-brand-500 text-white' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-brand-50 hover:border-brand-200 hover:text-brand-600'}`}>✎</button>
                  <button onClick={() => remove(product._id)} className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-xs text-gray-400 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition">🗑</button>
                </div>
              </div>

              {/* 内联编辑表单 */}
              {isEditing && (
                <InlineEditForm
                  product={product}
                  categories={categories}
                  onClose={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); onDataChange() }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30 shadow-lg">
          <div className="max-w-lg mx-auto space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">已选 {selectedIds.size} 项</span>
              <div className="flex-1 flex gap-1.5">
                <button onClick={() => batchAction('enable')} className="flex-1 py-2 bg-green-500 text-white rounded-lg text-xs font-medium">上架</button>
                <button onClick={() => batchAction('disable')} className="flex-1 py-2 bg-gray-500 text-white rounded-lg text-xs font-medium">下架</button>
                <button onClick={() => batchAction('delete')} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-medium">删除</button>
                <button onClick={() => setSelectedIds(new Set())} className="px-3 py-2 text-gray-400 text-xs">✕</button>
              </div>
            </div>
            <div className="flex gap-1.5">
              <input
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
