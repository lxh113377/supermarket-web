import React from 'react'

interface IconProps {
  className?: string
}

// 轻量内联 SVG 图标集：stroke 继承 currentColor，供系统/空状态/看板/错误页复用。
// 设计语言与 Tailwind 一致：viewBox 24，strokeWidth 1.8，圆头圆角。
function Icon({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-5 h-5'}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** ⚠ 警示（错误/异常态） */
export function IconAlert({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3 2 20h20L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 📊 图表（看板/统计） */
export function IconChart({ className }: IconProps) {
  return (
    <Icon className={className}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <path d="M6 16.5V12" />
      <path d="M11 16.5V7" />
      <path d="M16 16.5V10" />
      <path d="M20.5 16.5V4.5" />
    </Icon>
  )
}

/** 📦 商品/包裹（商品相关空状态） */
export function IconBox({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </Icon>
  )
}

/** 🛒 购物车（购物空状态） */
export function IconCart({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2.5 3.5h2l2.4 12h11l2.6-9H6" />
    </Icon>
  )
}

/** 🤖 AI 助手（对话/建议） */
export function IconRobot({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="0.8" fill="currentColor" stroke="none" />
      <line x1="9" y1="12.5" x2="9" y2="14.5" />
      <line x1="15" y1="12.5" x2="15" y2="14.5" />
      <path d="M9.5 17h5" />
    </Icon>
  )
}

/** ◌ 空（通用空状态） */
export function IconEmpty({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4.5 4.5" />
      <line x1="8.5" y1="11" x2="13.5" y2="11" />
    </Icon>
  )
}