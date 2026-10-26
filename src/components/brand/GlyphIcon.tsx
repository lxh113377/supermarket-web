import type { ReactNode } from 'react'

/**
 * 数据位图形的**自绘线稿**替身（2026-10-26 第 91 轮）。
 *
 * 为什么必须有：分类与服务的数据里存的是 emoji（🍜 📦  🖨️ …共 20 枚），渲染在柜台台账的
 * 暖台、封面带与服务页刊头上。emoji 是**系统字体图形**：颜色与造型由 OS 决定（同一枚 🏠
 * 在 Windows 与 macOS 上是两套配色两套形），于是「三色锚点是唯一色相来源」这条铁律在这一层
 * 根本不成立 —— 而且它是全站模板感最重的一处残留（评审原话：「emoji 图标 = 模板感最大残留」）。
 *
 * 口径：
 *  - **不改数据**：emoji 字符串仍是数据里的键（后台与 D1 里存的就是这些值，改数据会牵动
 *    契约与既有记录）。本件只做「emoji → 本站线稿」的映射，未命中的一律回落原字形，
 *    所以新增服务时不会因为忘了配图而空一块。
 *  - 语言与 Icons.tsx 一致：viewBox 24、strokeWidth 1.6、圆头圆角、描边继承 currentColor。
 *  - 全部 aria-hidden：图形不承载语义（服务名就是旁边的文字），与 contrastAudit 对「不含信息
 *    字符的纯装饰图形」的豁免口径一致。
 */

/** emoji（数据里的原字形）→ 本站线稿 */
const GLYPHS: Record<string, ReactNode> = {
  // 生活 / 零食 / 餐食
  "🍜": (<><path d="M4 11h16a8 8 0 0 1-16 0Z" /><path d="M3 19h18" /><path d="M9 7c0-1.6 1.2-1.8 1.2-3.2" /><path d="M13.5 7c0-1.6 1.2-1.8 1.2-3.2" /></>),
  "🥡": (<><path d="M6 8h12l-1.2 11.2a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-.8Z" /><path d="M5 8l7-4 7 4" /><path d="M9.5 12.5h5" /></>),
  "📦": (<><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></>),
  "👟": (<><path d="M3 16h13.5a4.5 4.5 0 0 0 4.5-3.2c-2.4-.4-3.6-1.4-4.6-3.1-1.3.9-2.4 1.4-3.6 1.4" /><path d="M3 16v-5l3 1.2" /><path d="M3 19h18" /></>),
  "🧹": (<><path d="M14 3.5 20.5 10" /><path d="M11.5 6 18 12.5" /><path d="M11.5 6 5 12.5V16h3.5l6.5-6.5" /><path d="M5 16l-1.5 4.5L8 19l-3-3" /></>),
  // 财务 / 健康
  "💳": (<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19" /><path d="M6 15h4" /></>),
  "🏋️": (<><path d="M4 9v6" /><path d="M20 9v6" /><path d="M2 11h2" /><path d="M20 11h2" /><path d="M6 12h12" /><path d="M6.5 8v8" /><path d="M17.5 8v8" /></>),
  "🩺": (<><path d="M6 3v5a5 5 0 0 0 10 0V3" /><path d="M11 13v3a4 4 0 0 0 8 0v-1.5" /><circle cx="19" cy="12" r="2.2" /></>),
  // 娱乐 / 数码
  "🎮": (<><path d="M7.5 8h9a5.5 5.5 0 0 1 5.4 6.5l-.5 2.6A2.2 2.2 0 0 1 18 18.4L16.5 17h-9L6 18.4a2.2 2.2 0 0 1-3.4-1.3l-.5-2.6A5.5 5.5 0 0 1 7.5 8Z" /><path d="M8 12v3" /><path d="M6.5 13.5h3" /><circle cx="16" cy="12.8" r="0.9" fill="currentColor" stroke="none" /><circle cx="18.2" cy="14.8" r="0.9" fill="currentColor" stroke="none" /></>),
  "💻": (<><rect x="4" y="5" width="16" height="11" rx="1.6" /><path d="M2.5 19.5h19" /><path d="M9.5 19.5h5" /></>),
  "🖥️": (<><rect x="3" y="4.5" width="18" height="12" rx="1.6" /><path d="M12 16.5v3" /><path d="M8 19.5h8" /><path d="M7 9h6" /><path d="M7 12h4" /></>),
  "♻️": (<><path d="M8.5 5.5 11 3l2.5 2.5" /><path d="M11 3v6" /><path d="M19 10.5l2 3.5-2 3.5" /><path d="M23 14h-6" /><path d="M5 10.5 3 14l2 3.5" /><path d="M3 14h6" /><path d="M8 20.5h8l-2-3" /></>),
  "🏃": (<><circle cx="14.5" cy="4.5" r="2" /><path d="M13 8l-3 3 2 3-1.5 5.5" /><path d="M12 14l4 1.5 1 4" /><path d="M10 11 6 10" /><path d="M13 8l4 2 3-1" /></>),
  // 事务 / 打印 / 公告
  "📝": (<><path d="M5 3.5h9L19 8v12.5H5Z" /><path d="M14 3.5V8h5" /><path d="M8 12h7" /><path d="M8 15.5h7" /><path d="M8 19h4" /></>),
  "🖨️": (<><path d="M7 8V3.5h10V8" /><rect x="3.5" y="8" width="17" height="8" rx="1.6" /><path d="M7 16h10v4.5H7Z" /><path d="M17 11h.01" /></>),
  "🤝": (<><path d="M3 11l4-4 3 2.5 2-1.5 2 1.5 3-2.5 4 4" /><path d="M7 7v8a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7" /><path d="M10 13.5l2 2 2.5-2.5" /></>),
  "📢": (<><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8V8.5H5.5A1.5 1.5 0 0 0 4 10Z" /><path d="M8 8.5 20 4v16L8 15.5Z" /><path d="M11 16.5v3h3v-2" /></>),
  // 购物 / 影像 / 文书（组件位：图缺位占位、上传区、附件、说明卡、聊天气泡）
  "🛒": (<><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /><path d="M2.5 3.5h2l2.4 12h11l2.6-9H6" /></>),
  "🥤": (<><path d="M7 8h10l-1.2 12.5a1 1 0 0 1-1 .5H9.2a1 1 0 0 1-1-.5Z" /><path d="M6 8l1.5-4.5h9L18 8" /><path d="M14 3.5 16.5 1.5" /></>),
  "📷": (<><path d="M4 8h3l1.5-2.5h7L17 8h3v11.5H4Z" /><circle cx="12" cy="13" r="3.4" /></>),
  "🖼": (<><rect x="3.5" y="5" width="17" height="14" rx="1.6" /><circle cx="9" cy="10" r="1.6" /><path d="M3.5 17l5.5-5 4 3.5 3-2.5 4.5 4" /></>),
  "📋": (<><rect x="5" y="4.5" width="14" height="16.5" rx="1.6" /><path d="M9 4.5V3h6v1.5" /><path d="M8.5 10h7" /><path d="M8.5 13.5h7" /><path d="M8.5 17h4" /></>),
  "💬": (<><path d="M4 5.5h16v10.5H12l-4.5 3.5V16H4Z" /><path d="M8.5 10h7" /><path d="M8.5 12.8h4" /></>),
  // 分类封面
  "🏠": (<><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 12v8.5h13V12" /><path d="M10 20.5v-5h4v5" /></>),
  "📚": (<><path d="M4 4.5h5v15H4Z" /><path d="M9.5 4.5h5v15h-5Z" /><path d="M15 6l4.2 1.2 2.6 13.3-4.4-1Z" /><path d="M6 8h1" /><path d="M11.5 8h1" /></>),
  "💡": (<><path d="M9 17.5h6" /><path d="M10 20.5h4" /><path d="M12 3.5a6 6 0 0 1 3.6 10.8c-.6.5-.9 1.1-1 1.9h-5.2c-.1-.8-.4-1.4-1-1.9A6 6 0 0 1 12 3.5Z" /></>),
}

export default function GlyphIcon({ glyph, className }: { glyph: string; className?: string }) {
  const art = GLYPHS[glyph]
  if (!art) {
    // 未映射 ⇒ 回落原字形（新增服务忘了配图也不会空一块），仍按装饰处理
    return <span aria-hidden="true" className={className}>{glyph}</span>
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-[1.15em] w-[1.15em]"}
      aria-hidden="true"
    >
      {art}
    </svg>
  )
}
