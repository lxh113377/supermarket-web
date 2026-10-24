/** @type {import('tailwindcss').Config}
 *  色彩令牌（2026-10-25 重构 v2 · 老大钦定三色，色值一个色相都不下移）
 *  ─────────────────────────────────────────────
 *  深褐黑 #2A221D（沉静、厚实、原始感）—— 全站底色与结构面
 *  森林绿 #1F4A39（自然、稳固、生命力）—— 第二结构色：导航/区块/状态
 *  黄铜金 #B18739（坚韧、权威、岁月感）—— 唯一强调色：价格/选中/焦点/按钮
 *
 *  前景规则（WCAG 实算，比值见 docs/redesign-awwwards-v2.md）：
 *    黄铜金底 ⇒ 配深褐黑字（4.75:1）；米白压金只有 2.87:1，禁止
 *    深褐黑底 ⇒ 米白 #F4EFE7（13.64:1）；弱化正文用 #A99C88（5.8:1）
 *    森林绿底 ⇒ 米白（8.75:1）；金字用高亮金 #D9B166（4.97:1）
 *    价格/强调金字 #B18739 落在面板 #332A24 = 4.27:1（粗体大字，过 AA 大字 3:1）
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 黄铜金：品牌主强调。500 = 老大给定的 #B18739。
        brand: {
          50:  '#3a2f22',
          100: '#4a3c26',
          200: '#6b552c',
          300: '#d9b166',  // 高亮金（深底文字/图标 7.76:1）
          400: '#c99c4a',
          500: '#b18739',  // 主色（承载深褐黑字 4.75:1）
          600: '#98712e',
          700: '#7a5c20',
          800: '#5f481b',
          900: '#463514',
        },
        brass: {
          DEFAULT: '#b18739',
          deep: '#7a5c20',
          bright: '#d9b166',
        },
        // 深褐黑家族：全站之底
        espresso: {
          DEFAULT: '#2a221d',
          950: '#1c1714',
          900: '#241e19',
          850: '#2a221d',
          800: '#332a24',
          700: '#3e332b',
          600: '#4a3d33',
          500: '#5a4b3f',
        },
        // 森林绿家族：第二结构色
        forest: {
          DEFAULT: '#1f4a39',
          deep: '#16382b',
          mid: '#2c5f4b',
          soft: '#3e7a61',
        },
        // 旧 ink 令牌并入褐黑（保住既有 66 处 text-ink 的语义：浅底深字 → 深底浅字改由 cream 承载）
        ink: {
          DEFAULT: '#f4efe7',
          soft: '#e6dfd2',
          mute: '#a99c88',
        },
        // 浅面令牌
        cream: { DEFAULT: '#f4efe7', deep: '#ede6da' },
        panel: { DEFAULT: '#332a24', deep: '#3e332b' },
        mute: { DEFAULT: '#a99c88', dim: '#8c7f6d' },
        // 表面令牌（bg-surface 等旧类名继续可用，值已换褐黑体系）
        surface: { DEFAULT: '#2a221d', warm: '#241e19', card: '#332a24' },
        // 旧 dark-500/600/700 并入森林绿
        dark: { 500: '#2c5f4b', 600: '#1f4a39', 700: '#16382b' },
        // 状态语义：文字/底两两按「压深底 ≥4.5:1」校准
        green: { 50: '#1b3327', 100: '#24402f', 400: '#7fc48f', 500: '#5aa96c', 700: '#7fc48f', 800: '#3f7d4e', 900: '#2d5c39' },
        red: { 50: '#3a2320', 100: '#4a2b25', 200: '#6b3730', 500: '#e07a5f', 700: '#e88a72', 800: '#c96a52' },
        amber: { 50: '#3a2f1e', 100: '#4a3c26', 200: '#6b552c', 300: '#d9b166', 500: '#b18739', 600: '#c99c4a', 800: '#e0bd76', 900: '#8a6828' },
        emerald: { 50: '#1b3327', 100: '#24402f', 200: '#2f5439', 700: '#7fc48f', 800: '#3f7d4e' },
        gray: { 50: '#241e19', 100: '#332a24', 200: '#3e332b', 300: '#4a3d33', 400: '#5a4b3f', 600: '#a99c88', 700: '#c8bda9' },
        stone: { 50: '#332a24', 100: '#3e332b', 200: '#4a3d33', 300: '#5a4b3f', 400: '#a99c88', 500: '#a99c88', 600: '#b8ab97', 700: '#c8bda9', 800: '#e6dfd2' },
        orange: { 50: '#3a2f1e', 800: '#8a6828', 900: '#5f481b' },
        yellow: { 100: '#4a3c26', 700: '#b18739', 900: '#5f481b' },
        teal: { 700: '#1f4a39' },
        cyan: { 800: '#16382b' },
        blue: { 50: '#1e2c33', 700: '#8fb3c4', 800: '#5a7d8c' },
        purple: { 400: '#8c7f6d' },
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(0,0,0,0.45), 0 4px 16px -4px rgba(0,0,0,0.3)',
        'brand': '0 2px 6px -1px rgba(177,135,57,0.35), 0 10px 28px -10px rgba(138,104,40,0.5)',
        'card': '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -10px rgba(0,0,0,0.45)',
        'elevated': '0 4px 12px -2px rgba(0,0,0,0.5), 0 12px 40px -8px rgba(0,0,0,0.45)',
        'float': '0 8px 30px -4px rgba(0,0,0,0.55), 0 20px 60px -12px rgba(0,0,0,0.45)',
        'inner-soft': 'inset 0 2px 6px rgba(0,0,0,0.35)',
        'brass-glow': '0 0 0 1px rgba(177,135,57,0.35), 0 6px 24px -8px rgba(177,135,57,0.28)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['3.25rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'display-lg': ['2.25rem', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        'display-md': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'eyebrow':  ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.16em' }],
        '2xs':      ['0.6875rem', { lineHeight: '1rem' }],
        '3xs':      ['0.625rem', { lineHeight: '0.875rem' }],
        'price-sm': ['1.375rem', { lineHeight: '1.5rem', letterSpacing: '-0.02em' }],
        'price-md': ['2rem',     { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        'price-lg': ['2.5rem',   { lineHeight: '2.75rem', letterSpacing: '-0.03em' }],
        'card-title': ['0.9375rem', { lineHeight: '1.35rem' }],
      },
      borderRadius: { '2xl': '1rem', '3xl': '1.5rem', '4xl': '2rem' },
      keyframes: {
        'fade-in-up': { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'slide-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        'slide-down': { '0%': { opacity: '0', transform: 'translateY(-8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'shimmer': { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.16,1,0.3,1) both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down': 'slide-down 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
