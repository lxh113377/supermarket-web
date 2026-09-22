import { memo, type CSSProperties } from 'react'
import type { Category, Product } from '../../types'
import { productImageUrl, productSrcSet } from '../../utils/images'
import { formatPrice } from '../../utils/format'
import InlineEditForm from './ProductInlineEditForm'

interface ProductRowProps {
  product: Product
  /** 子分类展示名（父组件用 Map 预建索引后传入，避免每行做嵌套 find） */
  catLabel: string
  isEditing: boolean
  selected: boolean
  categories: Category[]
  onToggleSelect: (id: string) => void
  onToggleEdit: (id: string | null) => void
  onQuickToggle: (product: Product) => void
  onRemove: (id: string) => void
  onSaved: () => void
}

function ProductRow({
  product, catLabel, isEditing, selected, categories,
  onToggleSelect, onToggleEdit, onQuickToggle, onRemove, onSaved,
}: ProductRowProps) {
  const imgSrc = product.image || productImageUrl(product.order)
  const imgSrcSet = product.image ? undefined : productSrcSet(product.order)
  const enabled = product.enabled !== false

  return (
    <div>
      <div
        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
          isEditing
            ? 'border-brand-300 bg-brand-50/50 rounded-b-none'
            : selected
              ? 'border-brand-300 bg-brand-50/50'
              : 'border-gray-100 bg-white hover:border-gray-200'
        }`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(product._id)}
          aria-label={`选择 ${product.name || '商品'}`}
          className="w-4 h-4 accent-brand-500 shrink-0 rounded"
        />

        <div className="w-11 h-11 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 shrink-0">
          {imgSrc ? (
            <img
              src={imgSrc}
              srcSet={imgSrcSet}
              sizes="44px"
              width={44}
              height={44}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-red-300 text-[10px]">无图</div>
          )}
        </div>

        <div
          className="flex-1 min-w-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-500 rounded"
          role="button"
          tabIndex={0}
          aria-label={`编辑${product.name || '商品'}`}
          aria-expanded={isEditing}
          onClick={() => onToggleEdit(isEditing ? null : product._id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggleEdit(isEditing ? null : product._id)
            }
          }}
        >
          <p className={`text-sm font-medium truncate ${enabled ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
            {product.name}{product.spec ? ` (${product.spec})` : ''}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-brand-600 font-bold text-sm">¥{formatPrice(product.price)}</span>
            {catLabel && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded truncate">{catLabel}</span>}
          </div>
        </div>

        {/* 操作区：命中区统一撑到 44px。
            快捷开关的「按钮」是 44×44 的外壳，里面的 36×20 才是视觉开关（原先按钮本身只有 20px 高）；
            ✎ / 🗑 视觉 36px + .tap-44 外扩 4px，间距 gap-2.5（10px）= 2×4px 外扩，刚好不重叠。 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => onQuickToggle(product)}
            aria-label={enabled ? '下架商品' : '上架商品'}
            aria-pressed={enabled}
            className="w-11 h-11 flex items-center justify-center shrink-0"
          >
            <span
              aria-hidden="true"
              className={`w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-green-400' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
              />
            </span>
          </button>
          <button
            onClick={() => onToggleEdit(isEditing ? null : product._id)}
            aria-label={isEditing ? '收起编辑' : '编辑商品'}
            aria-expanded={isEditing}
            style={{ '--tap-x': '4px', '--tap-y': '4px' } as CSSProperties}
            className={`tap-44 w-9 h-9 rounded-lg border flex items-center justify-center text-xs transition ${
              isEditing
                ? 'bg-brand-500 border-brand-500 text-white'
                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-brand-50 hover:border-brand-200 hover:text-brand-600'
            }`}
          >
            <span aria-hidden="true">✎</span>
          </button>
          <button
            onClick={() => onRemove(product._id)}
            aria-label="删除商品"
            style={{ '--tap-x': '4px', '--tap-y': '4px' } as CSSProperties}
            className="tap-44 w-9 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-xs text-gray-400 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition"
          >
            <span aria-hidden="true">🗑</span>
          </button>
        </div>
      </div>

      {/* 内联编辑表单：紧贴本行正下方展开（禁弹窗/抽屉，见 chaoshi-admin-inline-edit） */}
      {isEditing && (
        <InlineEditForm
          product={product}
          categories={categories}
          onClose={() => onToggleEdit(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

export default memo(ProductRow)
