import { useState } from 'react'
import { updateProduct, createProduct } from '../../auth'
import type { Category, Product, SpecOption } from '../../types'

// 管理后台商品内联编辑表单（从 ProductsTab 拆出，2026-09-23）。
// ⚠️ 交互范式铁律（chaoshi-admin-inline-edit）：编辑表单必须展开在该条目正下方，
// 严禁改成弹窗 / 抽屉 / 底部固定面板 —— 用户已连续三轮否决过那三种形态。

// 可选口味上限（与服务端 sanitizeSpecOptions 同口径，前端先拦住，避免保存后才报错）
export const SPEC_OPTION_LIMIT = 20
const FLAVOR_MAX_LEN = 20

export interface ProductForm {
  name: string
  spec: string
  price: number
  costPrice: string
  subcategories: string[]
  enabled: boolean
  image: string
  images: string[]
  description: string
  order: number | string
  /** 库存储值串：''=不限售/不修改（禁把空串送服务端，Number('')===0 会被判为缺货） */
  stock: string
  /** 可选口味：enabled=false 的项顾客端不渲染（数据保留，随时可再开） */
  specOptions: SpecOption[]
}

export const emptyForm: ProductForm = {
  name: '', spec: '', price: 0, costPrice: '', subcategories: [],
  enabled: true, image: '', images: [], description: '', order: '', stock: '',
  specOptions: [],
}

interface InlineEditFormProps {
  product: Partial<Product>
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

export default function InlineEditForm({ product, categories, onClose, onSaved }: InlineEditFormProps) {
  const isNew = !product._id
  const [form, setForm] = useState<ProductForm>(isNew ? { ...emptyForm } : {
    name: product.name || '',
    spec: product.spec || '',
    price: product.price ?? 0,
    costPrice: product.costPrice != null ? String(product.costPrice) : '',
    subcategories: product.subcategories || [],
    enabled: product.enabled !== false,
    image: product.image || '',
    description: product.description || '',
    images: Array.isArray(product.images) ? product.images : [],
    order: product.order ?? '',
    stock: typeof product.stock === 'number' && product.stock >= 0 ? String(product.stock) : '',
    specOptions: Array.isArray(product.specOptions) ? product.specOptions : [],
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [newFlavor, setNewFlavor] = useState('')

  const toggleSub = (subId: string) => {
    const subs = form.subcategories.includes(subId)
      ? form.subcategories.filter(s => s !== subId)
      : [...form.subcategories, subId]
    setForm({ ...form, subcategories: subs })
  }

  // 口味开关：只切显隐、不删数据 —— 「今天没进这个口味」不该把配置本身丢掉，
  // 关掉后顾客端不再渲染这一项（见 utils/spec-options.ts 的 enabled 过滤）。
  const toggleFlavor = (label: string) => {
    setForm({
      ...form,
      specOptions: form.specOptions.map((o) =>
        o.label === label ? { ...o, enabled: o.enabled === false } : o),
    })
  }

  const removeFlavor = (label: string) => {
    setForm({ ...form, specOptions: form.specOptions.filter((o) => o.label !== label) })
  }

  const addFlavor = () => {
    const label = newFlavor.trim().slice(0, FLAVOR_MAX_LEN)
    if (!label) return
    if (form.specOptions.some((o) => o.label === label)) { setNewFlavor(''); return }
    if (form.specOptions.length >= SPEC_OPTION_LIMIT) return
    setForm({ ...form, specOptions: [...form.specOptions, { label, enabled: true }] })
    setNewFlavor('')
  }

  const save = async () => {
    setFormError('')
    if (!form.name.trim()) return setFormError('商品名称不能为空')
    setSaving(true)
    try {
      const images = (form.images || [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 9)
      const payload: Record<string, unknown> = {
        ...form,
        images,
        order: form.order === '' || form.order == null ? undefined : Number(form.order),
      }
      if (payload.order !== undefined && Number.isNaN(payload.order)) {
        setFormError('排序号必须是数字')
        return
      }
      let costPrice: number | undefined
      if (form.costPrice !== '') {
        const n = Number(form.costPrice)
        if (Number.isNaN(n) || n < 0) {
          setFormError('成本价必须是 ≥0 的数字')
          return
        }
        costPrice = Math.round(n * 100) / 100
      }
      payload.costPrice = costPrice
      let stock: number | undefined
      const stockStr = form.stock.trim()
      if (stockStr !== '') {
        if (!/^-?\d+$/.test(stockStr) || Number(stockStr) < -1) {
          setFormError('库存必须为整数（-1 或留空表示不限售）')
          return
        }
        stock = Number(stockStr)
      }
      payload.stock = stock
      if (!isNew && !product._id) {
        setFormError('缺少商品 ID，无法保存')
        return
      }
      const result = isNew ? await createProduct(payload) : await updateProduct(product._id as string, payload)
      if (result && 'code' in result && result.code !== 0) {
        setFormError('保存失败：' + (result.message || '未知错误'))
        return
      }
      onSaved()
    } catch (err) {
      setFormError('保存失败：' + (err instanceof Error ? err.message : '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // 表单控件统一类名（原先每行重复写 6 次同样的长串，改样式要改 6 处）
  const inputCls = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none'

  // 错误归属到具体字段：出错控件标 aria-invalid + aria-describedby 指向错误文案（读屏直接播报哪个字段错了）
  const errorField = formError.includes('名称')
    ? 'name'
    : formError.includes('排序')
      ? 'order'
      : formError.includes('成本价')
        ? 'costPrice'
        : formError.includes('库存')
          ? 'stock'
          : null
  const errProps = (field: string) =>
    errorField === field
      ? ({ 'aria-invalid': true, 'aria-describedby': 'inline-edit-error' } as const)
      : {}

  return (
    <div className="px-3 pb-3 pt-1 bg-brand-50/30 rounded-b-xl border border-t-0 border-brand-100 -mt-1.5">
      {/* 字段用 aria-label 关联（原先只有 placeholder，读屏不播报字段名，输入后即丢失） */}
      <div className="grid grid-cols-2 gap-2">
        <input
          aria-label="商品名称（必填）"
          placeholder="名称 *"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className={`col-span-2 ${inputCls}`}
          {...errProps('name')}
        />
        <input aria-label="口味" placeholder="口味" value={form.spec} onChange={e => setForm({ ...form, spec: e.target.value })} className={inputCls} />
        <input aria-label="售价" type="number" step="0.01" placeholder="价格" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className={inputCls} />
        <input aria-label="成本价（可选）" type="number" step="0.01" min="0" placeholder="成本价（可选）" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} className={inputCls} {...errProps('costPrice')} />
        <input aria-label="库存（留空不限售）" type="number" step="1" min="-1" placeholder="库存（留空=不限售）" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className={inputCls} {...errProps('stock')} />
        <input aria-label="排序号" type="number" step="1" placeholder="排序号" value={form.order} onChange={e => setForm({ ...form, order: e.target.value })} className={inputCls} {...errProps('order')} />
        <input aria-label="主图 URL（可选）" placeholder="主图 URL（可选）" value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} className={inputCls} />
      </div>
      <textarea
        aria-label="轮播图 URL（每行一个，最多 9 张）"
        placeholder="轮播图 URL（每行一个，最多 9 张，可选）"
        value={(form.images || []).join('\n')}
        onChange={e => setForm({ ...form, images: e.target.value.split('\n') })}
        rows={2}
        className={`mt-2 w-full ${inputCls} resize-none`}
      />
      <textarea
        aria-label="商品介绍（可选）"
        placeholder="商品介绍（可选）"
        value={form.description || ''}
        onChange={e => setForm({ ...form, description: e.target.value })}
        rows={2}
        className={`mt-2 w-full ${inputCls} resize-none`}
      />
      {/* 可选口味：点药丸切显隐（划线=顾客端不显示），× 删除，输入框追加 */}
      <div className="mt-2" role="group" aria-label="可选口味（关掉即顾客端不显示）">
        <p className="text-[11px] font-semibold text-gray-500 mb-1">
          可选口味（关掉即顾客端不显示）
          {form.specOptions.length > 0 && (
            <span className="ml-2 font-normal text-gray-400">
              {form.specOptions.filter((o) => o.enabled !== false).length}/{form.specOptions.length} 个在显示
            </span>
          )}
        </p>
        {form.specOptions.length === 0 && (
          <p className="text-[11px] text-gray-400">未配置口味，该商品在顾客端不出现口味选择器</p>
        )}
        <ul className="flex flex-wrap gap-1 list-none p-0 m-0">
          {form.specOptions.map((o) => {
            const on = o.enabled !== false
            return (
              <li key={o.label} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => toggleFlavor(o.label)}
                  aria-pressed={on}
                  aria-label={`口味 ${o.label} 当前${on ? '显示' : '已隐藏'}，点击切换`}
                  title={on ? '点击在顾客端隐藏该口味' : '已隐藏，点击恢复显示'}
                  className={`px-2 py-0.5 rounded-l text-[11px] border transition ${
                    on
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-400 border-gray-200 line-through'
                  }`}
                >
                  {o.label}
                </button>
                <button
                  type="button"
                  onClick={() => removeFlavor(o.label)}
                  aria-label={`删除口味 ${o.label}`}
                  title="从清单中删除"
                  className="px-1.5 py-0.5 rounded-r text-[11px] border border-l-0 border-gray-200 bg-white text-gray-400 hover:text-red-500 transition"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex gap-1 mt-1.5">
          <input
            aria-label="新增口味名称"
            placeholder={`新增口味（如 番茄味，最多 ${SPEC_OPTION_LIMIT} 个）`}
            value={newFlavor}
            maxLength={FLAVOR_MAX_LEN}
            onChange={(e) => setNewFlavor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFlavor() } }}
            className={`flex-1 min-w-0 ${inputCls}`}
          />
          <button
            type="button"
            onClick={addFlavor}
            disabled={!newFlavor.trim() || form.specOptions.length >= SPEC_OPTION_LIMIT}
            className="px-3 py-2 rounded-lg text-xs bg-white border border-gray-200 text-gray-600 hover:border-brand-300 disabled:opacity-40 transition"
          >
            添加
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-2" role="group" aria-label="商品分类（可多选）">
        {categories.map(cat => cat.subcategories.map(sub => (
          <button
            key={sub.id}
            onClick={() => toggleSub(sub.id)}
            aria-pressed={form.subcategories.includes(sub.id)}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${form.subcategories.includes(sub.id) ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-500 border-gray-200'}`}
          >
            {sub.name}
          </button>
        )))}
        <button
          onClick={() => setForm({ ...form, enabled: !form.enabled })}
          aria-pressed={form.enabled}
          aria-label={form.enabled ? '当前已上架，点击下架' : '当前已下架，点击上架'}
          className={`px-2 py-0.5 rounded text-[11px] border transition ml-auto ${form.enabled ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-400 border-gray-200'}`}
        >
          {form.enabled ? '上架' : '下架'}
        </button>
      </div>
      {/* 校验错误即时播报；id 供出错字段的 aria-describedby 关联 */}
      <div role="alert" aria-live="assertive">
        {formError && (
          <p id="inline-edit-error" className="mt-2 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
        )}
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
