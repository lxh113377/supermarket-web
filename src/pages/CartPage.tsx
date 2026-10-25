import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import CartItem from '../components/CartItem'
import EmptyState from '../components/EmptyState'
import { IconCart } from '../components/Icons'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalAmount, getTotalCount } from '../cart'
import { getProducts } from '../db'
import { formatYuan } from '../utils/format'
import { MIN_DELIVERY_AMOUNT, meetsMinDelivery, minDeliveryGap } from '../data/deliveryLimits'
import { useInlineConfirm } from '../hooks/useInlineConfirm'
import type { Cart, CartItem as CartItemType, Product } from '../types'

interface PriceChange {
  name: string
  oldPrice: number
  newPrice: number
}

export default function CartPage() {
  const navigate = useNavigate()
  const [cart, setCart] = React.useState<Cart>(() => getCart())
  const [priceChanges, setPriceChanges] = React.useState<PriceChange[]>([])
  // 清空购物车走内联两步确认（arm → 再点一次 = 确认），替代原生 confirm()：见 hooks/useInlineConfirm
  const { arm: armClear, disarm: disarmClear, isArmed: clearArmed } = useInlineConfirm()

  // 检测价格变动并同步刷新购物车显示价格（仅在页面打开时同步一次）
  const initialCartRef = React.useRef<Cart>(cart)
  React.useEffect(() => {
    const cart = initialCartRef.current
    if (cart.items.length === 0) return
    getProducts().then((products: Product[]) => {
      const changes: PriceChange[] = []
      let needUpdate = false
      const updatedItems = cart.items.map(item => {
        // 按 productId 查目录是**有意**的：口味不决定单价（`src/utils/spec-options.ts` 头部口径），
        // 所以同商品的两个口味行共用同一个目录价，这里不需要按行身份查。别"顺手改成按 spec 查"。
        const latest = products.find(p => p._id === item.productId)
        if (latest && Math.abs(latest.price - item.price) > 0.001) {
          changes.push({ name: item.name, oldPrice: item.price, newPrice: latest.price })
          needUpdate = true
          return { ...item, price: latest.price }
        }
        return item
      })
      setPriceChanges(changes)
      if (needUpdate) {
        const newCart = { items: updatedItems }
        setCart(newCart)
        saveCart(newCart)
      }
    }).catch(() => {})
  }, [])

  // 三个回调用 useCallback 固定引用：CartItem 已 memo，
  // 传内联箭头函数会让 memo 完全失效（每次渲染都是新函数）。
  // 行身份是 (productId, spec)：三个回调都拿到整条 item，所以必须把 spec 一起传回去。
  // 只传 productId 的话，同商品的两个口味会被 +/- 与删除一起连带改动（第三十六轮修的那条键控的同侧）。
  const handleAdd = useCallback((item: CartItemType) => {
    const product = { _id: item.productId, name: item.name, spec: item.spec, price: item.price }
    const newCart = addToCart(cart, product)
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleRemove = useCallback((item: CartItemType) => {
    const newCart = removeFromCart(cart, item.productId, item.spec || '')
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleDelete = useCallback((item: CartItemType) => {
    const newCart = deleteFromCart(cart, item.productId, item.spec || '')
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleClose = () => {
    saveCart(cart)
    navigate(-1)
  }

  const totalAmount = getTotalAmount(cart)
  const totalCount = getTotalCount(cart)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-4 bg-panel/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90"
          aria-label="返回"
        >
          ←
        </button>
        <h1 className="text-base font-bold text-ink">购物车</h1>
        <div className="flex items-center gap-2">
          {/* 两步确认（替代原生 confirm()）：清空会一次丢掉所有已选商品，误触代价高。第一下点亮成红底
              「确认清空」，第二下才真清；取消三条路：点别处 / Esc / 6s 超时。
              ⚠️ 注释必须放在 {cond && ( ... )} 的外面：花括号加斜杠星那种 JSX 注释只在 children
                 位置合法，放进括号里的表达式位置会当场 SyntaxError（前四处按钮在 children 位所以没这问题）。 */}
          {cart.items.length > 0 && (
            <button
              onClick={() => {
                if (!clearArmed('clear')) { armClear('clear'); return }
                disarmClear()
                const empty = { items: [] }
                setCart(empty)
                saveCart(empty)
              }}
              onBlur={disarmClear}
              aria-label={clearArmed('clear') ? '确认清空购物车' : '清空购物车'}
              className={
                'text-xs px-2.5 py-1.5 rounded-lg transition-colors duration-200 ' +
                // 两分支分行：点亮态与悬停态的字色语义分开写，press-feedback 静态尺逐行配对
                (clearArmed('clear')
                  ? 'bg-red-700 text-cream font-medium'
                  : 'text-red-700 hover:bg-red-50 hover:text-cream')
              }
            >
              {clearArmed('clear') ? '确认清空' : '清空'}
            </button>
          )}
          <button
            onClick={handleClose}
            aria-label="关闭"
            className="w-9 h-9 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90 text-lg"
          >
            ×
          </button>
        </div>
      </div>

      <div role="main" id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-5 w-full max-w-3xl lg:max-w-4xl mx-auto">
        {priceChanges.length > 0 && (
          <div className="mb-4 bg-amber-50/80 border border-amber-200/60 rounded-2xl p-4 animate-slide-down" role="status">
            <p className="text-amber-800 text-xs font-medium mb-2">以下商品价格已变动（结算按最新价格）：</p>
            {priceChanges.map((c, i) => (
              <p key={i} className="text-amber-800 text-xs mt-1">
                {c.name}：{formatYuan(c.oldPrice)} → {formatYuan(c.newPrice)}
              </p>
            ))}
          </div>
        )}
        {cart.items.length === 0 ? (
          <EmptyState
            className="h-full justify-center"
            icon={<IconCart className="w-6 h-6" />}
            title="购物车是空的"
            description="还没有添加任何商品"
            action={
              <button
                onClick={() => navigate('/shop')}
                className="btn-primary px-5 py-2.5 text-sm"
              >
                去逛逛
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {cart.items.map((item, i) => (
              <div key={`${item.productId}::${item.spec || ''}`} className={`animate-fade-in-up stagger-${Math.min(i + 1, 6)}`}>
                <CartItem
                  item={item}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* safe-bottom 覆盖下内边距，为 iPhone 底部小黑条留白 */}
      {/* 票脚：购物车是收据的「草稿面」，结算条沿用出票语言（打孔线 + 票据行合计），
          与下单成功页的「超柿收据」形成 车 → 票 的同一叙事；e2e 锚点「共 N 件」原文保留。
          （注释必须在 && 括号外：JSX 注释只在 children 位置合法，CartPage 顶栏那次已踩过同坑。） */}
      {cart.items.length > 0 && (
        <div className="border-t-0 px-5 pt-2 bg-panel/95 backdrop-blur-sm safe-bottom">
          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto">
            <div className="receipt-perf receipt-perf--surface mb-3" aria-hidden="true" />
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-stone-500">共 {totalCount} 件</span>
              <span className="cart-ticket-row">
                <span>合计</span>
                <b className="cart-ticket-amount price-num">{formatYuan(totalAmount)}</b>
              </span>
            </div>
            {/* 起送门槛（2026-10-22 老大立规「总价低于六元不配送」）：
                在购物车这一站就把话说清，不让人填完楼栋房间号才被拦。
                未达标时结算入口直接换成「去凑单」（回 /shop），
                深链直接进 /order-confirm 的人由确认页那一道同文案闸兜住。 */}
            {!meetsMinDelivery(totalAmount) && (
              <div className="mb-3 flex items-start gap-2 rounded-2xl bg-amber-50/90 border border-amber-200/70 px-4 py-3" role="status">
                <span aria-hidden="true" className="mt-0.5">🛵</span>
                <p className="text-amber-800 text-xs leading-relaxed">
                  <span className="font-semibold">不满 {formatYuan(MIN_DELIVERY_AMOUNT)} 不配送</span>
                  ：当前合计 {formatYuan(totalAmount)}，再挑 {formatYuan(minDeliveryGap(totalAmount))} 即可下单。
                </p>
              </div>
            )}
            {/* CTA 分两态：达标走结算；未达标直接把用户送回选品，
                不把他带进一个「填完地址才发现下不了单」的死胡同。 */}
            {meetsMinDelivery(totalAmount) ? (
              <button
                onClick={() => navigate('/order-confirm')}
                className="btn-primary w-full py-4 rounded-2xl text-base shadow-elevated"
              >
                去支付
              </button>
            ) : (
              <button
                onClick={() => navigate('/shop')}
                className="btn-secondary w-full py-4 rounded-2xl text-base"
              >
                差 {formatYuan(minDeliveryGap(totalAmount))} 起送，去凑单
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
