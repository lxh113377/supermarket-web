import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { updateProduct, deleteProduct, batchUpdateProducts, batchDeleteProducts } from '../auth'
import type { Category, Product } from '../types'
import InlineEditForm from './admin/ProductInlineEditForm'
import ProductRow from './admin/ProductRow'
import EmptyState from './EmptyState'
import { IconBox, IconEmpty } from './Icons'
import { formatPrice } from '../utils/format'
import { specSearchText } from '../utils/spec-options'
import { useInlineConfirm } from '../hooks/useInlineConfirm'

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
  /**
   * 破坏性操作走内联两步确认（arm → 再点一次 = 确认），替代原生 confirm()。
   * 一个实例管三处（单删 key=product._id / 批量删 key=batch:delete / 批量改价
   * key=batch:price）—— hook 的 armedKey 是单值，这正好是想要的语义：
   * 点了某一行的删除，批量条不会同时亮着，反之亦然。
   * 取消三条路（点别处 blur / Esc / 6s 超时）由 hook 提供，见其注释。
   */
  const { arm: armConfirm, disarm: disarmConfirm, isArmed: isConfirmArmed } = useInlineConfirm()

  // 内联反馈条（替代原生 alert）
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
      list = list.filter(p => p.name.toLowerCase().includes(kw) || specSearchText(p).toLowerCase().includes(kw))
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

  // 对标 medusa 库存模块：管理端此前只有行内缺货/低库存徽标，无汇总视角。
  // 纯前端派生（不限售 stock=-1/undefined 不计），零后端改动。
  const stockSummary = useMemo(() => {
    let out = 0
    let low = 0
    for (const p of products) {
      if (typeof p.stock !== 'number' || p.stock < 0) continue
      if (p.stock === 0) out += 1
      else if (p.stock <= 5) low += 1
    }
    return { out, low }
  }, [products])

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

  /**
   * 单行删除拆成两个稳定回调，是为了保住 ProductRow 的 memo：
   * 判断「这是第一下还是第二下」放在 ProductRow 的按钮里（它拿到 deleteArmed 布尔），
   * 这里只暴露 requestDelete（点亮）与 remove（真删）。若把判断写成读 armedKey 的闭包，
   * 每次点亮都会让 onRemove 换引用 ⇒ 整表 60+ 行全部重渲染。
   */
  const requestDelete = useCallback((productId: string) => armConfirm(productId), [armConfirm])
  const remove = useCallback(async (productId: string) => {
    disarmConfirm()
    try { await deleteProduct(productId); onDataChange() }
    catch (err) { showNotice('error', '删除失败：' + (err instanceof Error ? err.message : '未知错误')) }
  }, [onDataChange, showNotice, disarmConfirm])

  const toggleEdit = useCallback((id: string | null) => setEditingId(id), [])

  const batchAction = async (action: string) => {
    const ids = [...selectedIds]
    const count = ids.length
    if (!count) return
    // 只有「删除」需要二次确认（不可逆）；上架/下架可逆，不套两步确认免得拖慢日常操作。
    // 第一下：点亮批量条的删除按钮并直接返回，等用户再点一次。
    if (action === 'delete' && !isConfirmArmed('batch:delete')) { armConfirm('batch:delete'); return }
    const label = action === 'enable' ? '上架' : action === 'disable' ? '下架' : '删除'
    try {
      const result = action === 'delete'
        ? await batchDeleteProducts(ids)
        : await batchUpdateProducts(ids.map(id => ({ productId: id, updates: { enabled: action === 'enable' } })))
      const failed = result && 'data' in result && Array.isArray(result.data?.failed) ? result.data.failed : []
      if (result && 'code' in result && result.code !== 0) {
        // 内联反馈条（与本文件其余失败路径一致；原生 alert 会阻塞主线程且打断批量心流）
        showNotice('error', `批量${label}失败：` + (result.message || '未知错误'))
        return
      }
      setSelectedIds(new Set())
      onDataChange()
      if (failed.length) showNotice('warn', `批量${label}部分失败：${failed.length}/${count} 未生效`)
    } catch (err) { showNotice('error', `批量${label}失败：` + (err instanceof Error ? err.message : '未知错误')) }
  }

  /**
   * 批量改价的目标值文案，提到组件级：armed 态的按钮要把「应用」写成「确认改为 X」——
   * 光写「确认改价」不够，用户第二下点之前必须还能看见自己设定的是什么值。
   *
   * ⚠️ 刻意返回**名词短语**（¥5.00 / 原价的 33%）而不是动词短语。第一版返回的是
   *    「统一设为 ¥5.00」，拼进按钮就成了「确认改为统一设为 ¥5.00」—— 两个动词叠在
   *    一起读不通。这个语病是被对比度变异顺带抓出来的：把 armed 底色调浅让判据点名
   *    按钮文案，人才第一次读到它长什么样。⇒ 界面文案也要有人读第二遍。
   * 只在批量条出现时（selectedIds.size>0）才计算；输入非法时返回空串，由调用侧兜底。
   */
  const priceTarget = useMemo(() => {
    const raw = batchPrice.trim()
    if (!raw || !selectedIds.size) return ''
    if (raw.includes('%')) {
      const v = parseFloat(raw)
      return isNaN(v) ? '' : `原价的 ${v}%`
    }
    const v = parseFloat(raw)
    return isNaN(v) ? '' : `¥${formatPrice(v)}`
  }, [batchPrice, selectedIds.size])

  const batchAdjustPrice = async () => {
    const ids = [...selectedIds]
    if (!batchPrice.trim() || !ids.length) return
    const isPercent = batchPrice.includes('%')
    const val = parseFloat(batchPrice)
    if (isNaN(val)) return showNotice('error', '请输入有效数字')
    // 批量改价会一次覆盖 N 个商品的现价且不可撤销 ⇒ 同样两步确认。第一下把「应用」
    // 按钮点亮成「确认改价」，第二下才真写。
    if (!isConfirmArmed('batch:price')) { armConfirm('batch:price'); return }
    try {
      // id → 商品一次建索引：原先 ids.map 内 products.find 是 O(选中数×全量)，全选批量改价时浪费
      const priceById = new Map(products.map(p => [p._id, p.price]))
      const items = ids.map(id => {
        const price = priceById.get(id)
        const newPrice = price !== undefined ? (isPercent ? Math.round(price * val) / 100 : val) : val
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
              ? 'bg-red-50 text-red-700 border-red-100'
              : 'bg-amber-50 text-amber-800 border-amber-100'
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
            aria-label="搜索商品名称或口味"
            placeholder="搜索商品名称/口味..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-brand-600"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm" aria-hidden="true">🔍</span>
        </div>
        <button onClick={() => setEditingId('new')} className="shrink-0 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-brass active:scale-[0.98]">+ 新增</button>
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
      {(stockSummary.out > 0 || stockSummary.low > 0) && (
        <div className="px-3 py-2 rounded-xl text-xs bg-amber-50 border border-amber-100 text-amber-800" role="status">
          库存提醒：缺货 {stockSummary.out} · 低库存(≤5) {stockSummary.low}（不限售商品不计）
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="按分类筛选">
        {[{ id: '', label: '全部' }, ...categories.map(c => ({ id: c.type, label: c.name }))].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterCat(f.id)}
            aria-pressed={filterCat === f.id}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition active:scale-[0.98] ${filterCat === f.id ? 'bg-brand-500 text-espresso' : 'bg-gray-100 text-stone-600 hover:bg-gray-200'}`}
          >
            {f.label}
          </button>
        ))}
        {/* hover 时背景转 gray-100，文字必须跟着加深一档：stone-500 压 gray-100 实测
            4.36:1 不过 AA（默认态压 bg-surface 是 4.59:1，刚过）。同文件其余 9 处
            hover:bg-gray-100 都配了 hover:text-*，这处是漏配。 */}
        <button onClick={selectAllFiltered} className="ml-auto rounded-lg px-3 py-1.5 text-xs text-stone-500 transition hover:bg-gray-100 hover:text-stone-700 active:scale-[0.98]">
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
            onRequestDelete={requestDelete}
            onRemove={remove}
            // 每行自己算布尔：armedKey 变化时只有「刚点亮的那行」和
            // 「刚退掉的那行」值真的变了 ⇒ 其余行 memo 不失效。
            deleteArmed={isConfirmArmed(product._id)}
            onDisarmDelete={disarmConfirm}
            onSaved={onDataChange}
          />
        ))}
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-panel border-t border-gray-200 px-4 py-3 z-30 shadow-lg safe-bottom">
          <div className="max-w-lg mx-auto space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500 shrink-0" aria-live="polite">已选 {selectedIds.size} 项</span>
              <div className="flex-1 flex gap-1.5">
                <button onClick={() => batchAction('enable')} className="flex-1 py-2 bg-green-700 text-cream rounded-lg text-xs font-medium">上架</button>
                <button onClick={() => batchAction('disable')} className="flex-1 py-2 bg-espresso text-cream rounded-lg text-xs font-medium">下架</button>
                {/* 两步确认：batchAction 内部判断第一下只点亮。上架/下架可逆，不套两步确认。
                    ⚠️ armed 文案刻意只用「确认」两字，不写「确认删除 63 个」—— 实测后者在
                    68px 的 flex-1 按钮里会折成两行（文字高 32px），而这一排是 flex 容器、
                    align-items 默认 stretch ⇒ 一个按钮变高会把整排四个按钮一起从 32px 撑到
                    48px，用户点第一下就看到版面跳一次。数量不必重复写：同一排左边就有
                    「已选 63 项」，完整语义由 aria-label 承载给读屏。
                    与 ProductRow 行内删除同一口径（那里也是保持 36px 只换「确认」二字）。 */}
                <button
                  onClick={() => batchAction('delete')}
                  onBlur={disarmConfirm}
                  aria-label={isConfirmArmed('batch:delete') ? `确认删除选中的 ${selectedIds.size} 个商品（不可撤销）` : '批量删除选中商品'}
                  className="flex-1 whitespace-nowrap py-2 bg-red-700 text-cream rounded-lg text-xs font-medium transition-colors duration-200"
                >
                  {isConfirmArmed('batch:delete') ? '确认' : '删除'}
                </button>
                <button onClick={() => setSelectedIds(new Set())} aria-label="取消选择" className="tap-44 px-3 py-2 text-stone-500 text-xs">✕</button>
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
              {/* 两步确认（与上面批量删除同一口径）。
                  ⚠️ armed 文案不带目标值，且按钮用 min-w-14 + whitespace-nowrap 锁宽。
                  实测第一版写「确认改为 ¥5.00」时按钮从 47.7px 涨到 103.1px，而这一行是
                  flex、输入框 flex-1 ⇒ 按钮变宽等量吃掉输入框（264.3 → 208.9px），
                  用户点第一下会看到自己正在输入的框突然变窄。目标值本来就显示在旁边的
                  输入框里，按钮重复它既挤版面又冗余；完整语义交给 aria-label。
                  第二版收成「应用 / 确认改价」仍跳 15.3px —— 因为两态**字数不同**
                  （2 字 vs 4 字 = 48px vs 72px），min-w-14 只兜得住较窄的一边。
                  最终解法是让两态等字数：「应用改价 / 确认改价」都是 4 字 ⇒ 恒 71.3px
                  （实测值；我先前写的 72px 是估的，又一次"没量就写"）。
                  ⇒ 按钮文案换态要锁宽度，真正的约束是**字数等长**，不是给个 min-width。

                  第三轮再补 shrink-0：flex 子项默认可收缩，实测按钮会被挤到 min-w-14
                  下限（71.3 → 56px），也就是「应用改价」在窄屏 armed 时会被截断 ——
                  那是比输入框变窄更严重的缺陷（按钮文字被切）。加 shrink-0 之后挤压只会
                  落到 flex-1 的输入框上。五档视口实测（320/360/390/768/1440）：armed 与
                  idle 的输入框宽度完全一致、按钮恒 71.3px、无文字截断，320px 下也无横向
                  溢出（那一档按钮 44.7px 仍 ≥ 触控最小尺寸）。 */}
              <button
                onClick={batchAdjustPrice}
                onBlur={disarmConfirm}
                aria-label={isConfirmArmed('batch:price')
                  ? `确认把选中的 ${selectedIds.size} 个商品改为 ${priceTarget}（不可撤销）`
                  : `应用批量改价：${priceTarget || '请先输入价格'}`}
                className={
                  'shrink-0 min-w-14 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 ' +
                  (isConfirmArmed('batch:price') ? 'bg-red-700 text-cream' : 'bg-brand-500 text-espresso')
                }
              >
                {isConfirmArmed('batch:price') ? '确认改价' : '应用改价'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
