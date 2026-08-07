import React, { useMemo } from 'react'

// ---- 纯 SVG 折线图 ----
function LineChart({ data, labels, color = '#eab308', height = 140 }) {
  const width = 300
  const padding = { top: 16, right: 12, bottom: 24, left: 32 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const max = Math.max(...data, 1)
  const points = data.map((v, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - (v / max) * chartH,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaD = pathD + ` L${points[points.length - 1]?.x || padding.left},${padding.top + chartH} L${padding.left},${padding.top + chartH} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }}>
      {/* 网格线 */}
      {[0, 0.5, 1].map(ratio => {
        const y = padding.top + chartH - ratio * chartH
        return (
          <g key={ratio}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#f3f4f6" strokeWidth="1" />
            <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {Math.round(max * ratio)}
            </text>
          </g>
        )
      })}
      {/* 渐变面积 */}
      <defs>
        <linearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#lineArea)" />
      {/* 折线 */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* 数据点 */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="white" stroke={color} strokeWidth="2" />
      ))}
      {/* X轴标签 */}
      {labels.map((label, i) => (
        <text
          key={i}
          x={padding.left + (i / Math.max(labels.length - 1, 1)) * chartW}
          y={height - 4}
          textAnchor="middle"
          fontSize="9"
          fill="#9ca3af"
        >
          {label}
        </text>
      ))}
    </svg>
  )
}

// ---- 纯 SVG 环形图 ----
function DonutChart({ segments, size = 140 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return <p className="text-gray-300 text-sm text-center py-6">暂无数据</p>

  const radius = 50
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = 18
  let cumAngle = -90 // 从顶部开始

  const arcs = segments.map(seg => {
    const angle = (seg.value / total) * 360
    const startAngle = cumAngle
    const endAngle = cumAngle + angle
    cumAngle = endAngle

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180
    const x1 = cx + radius * Math.cos(startRad)
    const y1 = cy + radius * Math.sin(startRad)
    const x2 = cx + radius * Math.cos(endRad)
    const y2 = cy + radius * Math.sin(endRad)
    const largeArc = angle > 180 ? 1 : 0

    return {
      ...seg,
      d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      pct: Math.round((seg.value / total) * 100),
    }
  })

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="bold" fill="#1f2937">
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#9ca3af">
          总销量
        </text>
      </svg>
      <div className="space-y-2">
        {arcs.map((arc, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: arc.color }} />
            <span className="text-gray-600">{arc.label}</span>
            <span className="text-gray-400 font-medium">{arc.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- 主组件 ----
export default function DashboardTab({ orders }) {
  const stats = useMemo(() => {
    const now = new Date()
    const day = now.getDay() || 7
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1)
    const weekOrders = orders.filter(o => new Date(o.createdAt) >= weekStart)
    const weekRevenue = weekOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.totalAmount || 0), 0)

    // 近7天订单趋势
    const dailyOrders = []
    const dailyLabels = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const nextD = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      const count = orders.filter(o => {
        const t = new Date(o.createdAt)
        return t >= d && t < nextD
      }).length
      dailyOrders.push(count)
      dailyLabels.push(`${d.getMonth() + 1}/${d.getDate()}`)
    }

    // 分类销量占比
    const itemMap = {}
    let drinkQty = 0
    let foodQty = 0
    const drinkSubs = new Set(['low_sugar', 'vitamin', 'energy', 'tea', 'soda', 'sweet', 'water'])
    orders.filter(o => o.status !== 'cancelled').forEach(o => {
      o.items.forEach(i => {
        const key = i.name + (i.spec ? '(' + i.spec + ')' : '')
        itemMap[key] = (itemMap[key] || 0) + i.quantity
        // 按子分类判断归属
        if (i.subcategories) {
          if (i.subcategories.some(s => drinkSubs.has(s))) drinkQty += i.quantity
          else foodQty += i.quantity
        } else {
          // 无子分类信息的按名称粗略分
          drinkQty += i.quantity
        }
      })
    })
    const topItems = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 10)

    return { weekOrders: weekOrders.length, weekRevenue, totalOrders: orders.length, topItems, dailyOrders, dailyLabels, drinkQty, foodQty }
  }, [orders])

  const pieSegments = [
    { label: '饮品', value: stats.drinkQty, color: '#eab308' },
    { label: '食品', value: stats.foodQty, color: '#6366f1' },
  ].filter(s => s.value > 0)

  return (
    <div className="space-y-4">
      {/* 数据卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card text-center animate-fade-in-up stagger-1">
          <p className="text-2xl font-bold text-gray-900">{stats.weekOrders}</p>
          <p className="text-[10px] text-gray-400 mt-1">本周订单</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card text-center animate-fade-in-up stagger-2">
          <p className="text-2xl font-bold text-brand-600">¥{stats.weekRevenue.toFixed(0)}</p>
          <p className="text-[10px] text-gray-400 mt-1">本周营收</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card text-center animate-fade-in-up stagger-3">
          <p className="text-2xl font-bold text-gray-900">{stats.totalOrders}</p>
          <p className="text-[10px] text-gray-400 mt-1">累计订单</p>
        </div>
      </div>

      {/* 折线图：近7天订单趋势 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-3">
        <h3 className="section-title mb-3">近 7 天订单趋势</h3>
        <LineChart data={stats.dailyOrders} labels={stats.dailyLabels} />
      </div>

      {/* 环形图：分类占比 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-4">
        <h3 className="section-title mb-4">分类销量占比</h3>
        <DonutChart segments={pieSegments} />
      </div>

      {/* 销量排行 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-5">
        <h3 className="section-title mb-4">商品销量 TOP10</h3>
        {stats.topItems.length === 0 ? (
          <div className="text-center py-6">
            <span className="text-2xl block mb-2">📊</span>
            <p className="text-gray-300 text-sm">暂无数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.topItems.map(([name, qty], i) => (
              <div key={name} className="flex items-center justify-between">
                <span className="flex items-center gap-3 text-sm text-gray-700">
                  <span className={`w-6 h-6 rounded-lg text-xs flex items-center justify-center font-bold ${
                    i === 0 ? 'bg-red-50 text-red-500' :
                    i === 1 ? 'bg-orange-50 text-orange-500' :
                    i === 2 ? 'bg-brand-50 text-brand-600' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    {i + 1}
                  </span>
                  <span className="truncate max-w-[160px]">{name}</span>
                </span>
                <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-1 rounded-md">x{qty}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
