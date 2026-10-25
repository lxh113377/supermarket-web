import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getOrderStatus } from '../db'
import { orderStatusLabel, ORDER_FLOW } from '../utils/orderStatus'

/**
 * 顾客侧订单进度查询（2026-09-24 对标 litemall 订单跟踪）。
 * 匿名设计：订单号即凭证（genId 时间戳+随机，不可枚举），后端 getOrderStatus 只回 status/updatedAt。
 * 视觉（2026-10-25）：进度列表改「brass 时间线」—— 一根金线轨道穿起节点，压轨的当前步
 * 用黄铜实底点亮；订单号同时以收据票据的等宽字体上屏，与成功/支付两页同一「出票」语言。
 * 版面（2026-10-26 第二轮八维打磨）：桌面双栏「查询工单 + 状态台账」—— 左 = intake-sheet
 * 同族工单（输入行 + 出票结果），右 = 问事处状态台账（五态逐条记档，铜序号 + 虚线分行），
 * 治桌面首屏 80% 空洞；窄档单列堆叠（台账不 display:none，否则零面积文字叶被可达闸判红）。
 */

/** 状态台账（纯展示层，不承载数据语义；状态机真源 = utils/orderStatus 的
 *  ORDER_FLOW/orderStatusLabel，进度列表用它）。
 *  台账用「账本别名」而非状态标签原文：contrast 闸的 order-query-result 前置
 *  getByText('已支付') 是子串匹配，台账若再放一个「已支付」叶子就 strict 撞双
 *  （2026-10-26 实测红）。别名与状态一一对应，白话注解释它在主链里的意思。 */
const STATUS_LEDGER: Record<string, { alias: string; note: string }> = {
  pending: { alias: '立单', note: '单子已立，等扫码付款' },
  paid: { alias: '收款', note: '款已收讫，商家安排出货' },
  delivering: { alias: '出送', note: '骑手在送往楼栋的路上' },
  completed: { alias: '闭环', note: '单子送达闭环，欢迎再来' },
  cancelled: { alias: '废单', note: '旁路终态，可从废单重立' },
}

export default function OrderQueryPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [input, setInput] = useState(() => state?.orderId || sessionStorage.getItem('sm_query_order') || sessionStorage.getItem('sm_payment_order') || '')
  const [status, setStatus] = useState<{ status: string; updatedAt?: string } | null>(null)
  const [queried, setQueried] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const autoRef = useRef(false)

  const lookup = async (id: string) => {
    const oid = id.trim()
    if (!oid) { setNotice('请输入订单号'); return }
    setLoading(true)
    setNotice('')
    const s = await getOrderStatus(oid)
    setLoading(false)
    if (s) { setStatus(s); setQueried(oid) }
    else { setStatus(null); setQueried(oid); setNotice('未查到该订单，请核对订单号（注意不要带空格）') }
  }

  // 从支付/成功流程进来时带了单号 → 自动查一次，顾客零输入
  useEffect(() => {
    if (!autoRef.current && input) {
      autoRef.current = true
      void lookup(input)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIndex = status ? ORDER_FLOW.indexOf(status.status) : -1

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in paper-grain">
      <div className="px-5 py-4 bg-panel/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90"
          aria-label="返回"
        >
          ←
        </button>
        <h1 className="text-base font-bold text-ink">订单查询</h1>
        <span className="w-9" />
      </div>

      <div role="main" id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-5 w-full max-w-4xl mx-auto">
        {/* 无结果态垂直居中治桌面下半空洞（同 AssistantPage 空态口径）：
            居中只加在内层且仅无结果时 —— 有结果内容变高，居中会裁顶（经典 flex 陷阱）。 */}
        <div className={status ? '' : 'query-desk-center'}>
        <div className="query-desk">
          {/* 左栏：查询工单（intake-sheet 同族装订缘） */}
          <section className="intake-sheet animate-fade-in-up">
            <div className="intake-head">
              <i aria-hidden="true" />
              <h2>查询工单</h2>
              <span>Query Sheet</span>
            </div>
            <div className="flex gap-2">
              <input
                aria-label="订单号"
                type="search"
                placeholder="输入订单号（o_ 开头）"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void lookup(input) }}
                className="input-base flex-1 min-w-0 rounded-xl text-sm"
              />
              <button
                onClick={() => void lookup(input)}
                disabled={loading}
                className="px-4 py-2.5 bg-brand-500 text-espresso rounded-xl text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition"
              >
                {loading ? '查询中' : '查询'}
              </button>
            </div>
            <div role="status" aria-live="polite">
              {notice && <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2">{notice}</p>}

              {status && (
                <div className="mt-4 bg-panel rounded-2xl p-5 shadow-card border border-gray-100/80 query-flow animate-fade-in-up">
                  <div className="flex items-end justify-between gap-3 border-b border-gray-100 pb-3">
                    <div className="min-w-0">
                      {/* e2e 锚点：getByText('订单号', { exact: true }) 钉的是这个标签本身 */}
                      <p className="receipt-serial-label" style={{ color: 'rgb(var(--t-mute))' }}>订单号</p>
                      <p className="receipt-serial-id price-num text-ink break-all">{queried}</p>
                    </div>
                    <span aria-hidden="true" className="brand-bar mb-1 h-0.5 w-10 shrink-0 rounded-full opacity-70" />
                  </div>
                  {status.status === 'cancelled' ? (
                    <p className="pt-4 text-base font-bold text-red-700">该订单已取消</p>
                  ) : (
                    <ol className="pt-1">
                      {ORDER_FLOW.map((s, i) => {
                        const done = i < currentIndex
                        const current = i === currentIndex
                        return (
                          <li key={s}>
                            <span
                              aria-hidden="true"
                              className={
                                done
                                  ? 'step-done w-5 h-5 flex items-center justify-center rounded-full text-3xs shrink-0'
                                  : current
                                  ? 'bg-brand-500 text-espresso w-5 h-5 flex items-center justify-center rounded-full text-3xs shrink-0 ring-4 ring-brand-300'
                                  : 'bg-gray-100 text-stone-600 w-5 h-5 flex items-center justify-center rounded-full text-3xs shrink-0'
                              }
                            >
                              {done ? '✓' : i + 1}
                            </span>
                            <span className={current ? 'text-sm font-bold text-ink' : done ? 'text-sm text-stone-600' : 'text-sm text-stone-500'}>
                              {orderStatusLabel(s)}
                              {current && status.updatedAt && (
                                <span className="ml-2 text-xs font-normal text-stone-500">{new Date(status.updatedAt).toLocaleString()}</span>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                  {status.status === 'pending' && (
                    <button
                      onClick={() => navigate('/payment', { state: { orderId: queried, totalAmount: 0 } })}
                      className="mt-4 w-full py-3 bg-brand-500 text-espresso rounded-xl text-sm font-medium active:scale-[0.98] transition"
                    >
                      去支付
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="mt-5 text-xs text-stone-500 leading-relaxed">
              订单号在下单成功页可复制；如订单显示长期「待支付」请先确认已完成扫码付款并联系商家。
            </p>
          </section>

          {/* 右栏：问事处状态台账（窄档堆叠在工单下方，不隐藏） */}
          <aside className="query-faq animate-fade-in-up stagger-2">
            <div className="query-faq-head">
              <h2>问事处 · 状态台账</h2>
              <span>Order Desk</span>
            </div>
            {([...ORDER_FLOW, 'cancelled'] as string[]).map((s, i) => (
              <div key={s} className="query-faq-row">
                <span aria-hidden="true" className="counter-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="query-faq-name">{STATUS_LEDGER[s].alias}</span>
                  <span className="block query-faq-note">{STATUS_LEDGER[s].note}</span>
                </span>
              </div>
            ))}
          </aside>
        </div>
        </div>
      </div>
    </div>
  )
}
