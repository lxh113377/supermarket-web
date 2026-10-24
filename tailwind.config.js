/** @type {import('tailwindcss').Config}
 *  色彩令牌 v3（2026-10-25 · 双主题：昼 = 暖纸 / 夜 = 深褐黑）
 *  ─────────────────────────────────────────────────────────────
 *  老大钦定三色为唯一色相来源：
 *    深褐黑 #2A221D（沉静、厚实、原始感）
 *    森林绿 #1F4A39（自然、稳固、生命力）
 *    黄铜金 #B18739（坚韧、权威、岁月感）
 *  双主题口径：主题切换只换「语义槽」的取值，类名与 DOM 零改动。
 *    昼（默认）：暖纸 #FAF7F0 为底、暖墨 #241E19 为字 —— 白昼的铺子；
 *    夜：深褐黑 #241E19 为底、米白 #F4EFE7 为字 —— 夜里亮灯的铺子（v1 的气质保留为夜主题）。
 *  所有令牌以「RGB 三通道」存进 CSS 变量，Tailwind 用 rgb(var(--t-x) / <alpha-value>)
 *  接住，于是 bg-panel/95、text-cream/85 这类既有透明度写法在两个主题下都继续成立。
 *  前景铁律（WCAG 实算，见 docs/redesign-awwwards-v3.md）：
 *    昼：正文墨 #241E19/纸 15.4:1；次级 #6B5F51 5.8:1；价格金 #8A6520 4.6:1；
 *    夜：正文米白/褐 14.4:1；次级 #A99C88 6.1:1；亮金 #D9B166 7.7:1；
 *    黄铜金实底按钮一律配深褐字（4.98:1），两主题同值。
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 黄铜金族：500 = 钦定 #B18739；300 是「强调文字槽」（昼深金 / 夜亮金）
        brand: {
          50:  'rgb(var(--t-brand-50) / <alpha-value>)',
          100: 'rgb(var(--t-brand-100) / <alpha-value>)',
          200: 'rgb(var(--t-brand-200) / <alpha-value>)',
          300: 'rgb(var(--t-brand-300) / <alpha-value>)',
          400: 'rgb(var(--t-brand-400) / <alpha-value>)',
          500: 'rgb(var(--t-brand-500) / <alpha-value>)',
          600: 'rgb(var(--t-brand-600) / <alpha-value>)',
          700: 'rgb(var(--t-brand-700) / <alpha-value>)',
          800: 'rgb(var(--t-brand-800) / <alpha-value>)',
          900: 'rgb(var(--t-brand-900) / <alpha-value>)',
        },
        brass: {
          DEFAULT: 'rgb(var(--t-brand-500) / <alpha-value>)',
          deep: 'rgb(var(--t-brand-700) / <alpha-value>)',
          bright: 'rgb(var(--t-brass-bright) / <alpha-value>)',
        },
        // 深褐黑族：字面棕阶，两主题同值（它是「木料」，不随昼夜换色）
        espresso: {
          DEFAULT: 'rgb(var(--t-espresso) / <alpha-value>)',
          950: 'rgb(var(--t-espresso-950) / <alpha-value>)',
          900: 'rgb(var(--t-espresso-900) / <alpha-value>)',
          850: 'rgb(var(--t-espresso) / <alpha-value>)',
          800: 'rgb(var(--t-espresso-800) / <alpha-value>)',
          700: 'rgb(var(--t-espresso-700) / <alpha-value>)',
          600: 'rgb(var(--t-espresso-600) / <alpha-value>)',
          500: 'rgb(var(--t-espresso-500) / <alpha-value>)',
        },
        // 森林绿族：字面绿阶，两主题同值
        forest: {
          DEFAULT: 'rgb(var(--t-forest) / <alpha-value>)',
          deep: 'rgb(var(--t-forest-deep) / <alpha-value>)',
          mid: 'rgb(var(--t-forest-mid) / <alpha-value>)',
          soft: 'rgb(var(--t-forest-soft) / <alpha-value>)',
        },
        // 墨/米白：语义文字槽（昼墨夜米，对偶互换）
        ink: {
          DEFAULT: 'rgb(var(--t-ink) / <alpha-value>)',
          soft: 'rgb(var(--t-ink-soft) / <alpha-value>)',
          mute: 'rgb(var(--t-ink-mute) / <alpha-value>)',
        },
        cream: {
          DEFAULT: 'rgb(var(--t-cream) / <alpha-value>)',
          deep: 'rgb(var(--t-cream-deep) / <alpha-value>)',
        },
        panel: {
          DEFAULT: 'rgb(var(--t-panel) / <alpha-value>)',
          deep: 'rgb(var(--t-panel-deep) / <alpha-value>)',
        },
        mute: {
          DEFAULT: 'rgb(var(--t-mute) / <alpha-value>)',
          dim: 'rgb(var(--t-mute-dim) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--t-surface) / <alpha-value>)',
          warm: 'rgb(var(--t-surface-warm) / <alpha-value>)',
          card: 'rgb(var(--t-panel) / <alpha-value>)',
        },
        dark: {
          500: 'rgb(var(--t-forest-mid) / <alpha-value>)',
          600: 'rgb(var(--t-forest) / <alpha-value>)',
          700: 'rgb(var(--t-forest-deep) / <alpha-value>)',
        },
        // 语义状态：成功/危险/警告/信息，两主题各取「压得住本主题底」的一档
        green: {
          50: 'rgb(var(--t-green-50) / <alpha-value>)',
          100: 'rgb(var(--t-green-100) / <alpha-value>)',
          400: 'rgb(var(--t-green-400) / <alpha-value>)',
          500: 'rgb(var(--t-green-500) / <alpha-value>)',
          700: 'rgb(var(--t-green-700) / <alpha-value>)',
          800: 'rgb(var(--t-green-800) / <alpha-value>)',
          900: 'rgb(var(--t-green-900) / <alpha-value>)',
        },
        red: {
          50: 'rgb(var(--t-red-50) / <alpha-value>)',
          100: 'rgb(var(--t-red-100) / <alpha-value>)',
          200: 'rgb(var(--t-red-200) / <alpha-value>)',
          500: 'rgb(var(--t-red-500) / <alpha-value>)',
          700: 'rgb(var(--t-red-700) / <alpha-value>)',
          800: 'rgb(var(--t-red-800) / <alpha-value>)',
        },
        amber: {
          50: 'rgb(var(--t-amber-50) / <alpha-value>)',
          100: 'rgb(var(--t-amber-100) / <alpha-value>)',
          200: 'rgb(var(--t-amber-200) / <alpha-value>)',
          300: 'rgb(var(--t-amber-300) / <alpha-value>)',
          500: 'rgb(var(--t-brand-500) / <alpha-value>)',
          600: 'rgb(var(--t-amber-600) / <alpha-value>)',
          800: 'rgb(var(--t-amber-800) / <alpha-value>)',
          900: 'rgb(var(--t-amber-900) / <alpha-value>)',
        },
        emerald: {
          50: 'rgb(var(--t-green-50) / <alpha-value>)',
          100: 'rgb(var(--t-green-100) / <alpha-value>)',
          200: 'rgb(var(--t-emerald-200) / <alpha-value>)',
          700: 'rgb(var(--t-emerald-700) / <alpha-value>)',
          800: 'rgb(var(--t-emerald-800) / <alpha-value>)',
        },
        // 中性：暖灰（stone 族同源），禁冷灰（warm-foreground 闸）
        gray: {
          50: 'rgb(var(--t-gray-50) / <alpha-value>)',
          100: 'rgb(var(--t-gray-100) / <alpha-value>)',
          200: 'rgb(var(--t-gray-200) / <alpha-value>)',
          300: 'rgb(var(--t-gray-300) / <alpha-value>)',
          400: 'rgb(var(--t-gray-400) / <alpha-value>)',
          600: 'rgb(var(--t-gray-600) / <alpha-value>)',
          700: 'rgb(var(--t-gray-700) / <alpha-value>)',
        },
        stone: {
          50: 'rgb(var(--t-stone-50) / <alpha-value>)',
          100: 'rgb(var(--t-stone-100) / <alpha-value>)',
          200: 'rgb(var(--t-stone-200) / <alpha-value>)',
          300: 'rgb(var(--t-stone-300) / <alpha-value>)',
          400: 'rgb(var(--t-stone-400) / <alpha-value>)',
          500: 'rgb(var(--t-stone-500) / <alpha-value>)',
          600: 'rgb(var(--t-stone-600) / <alpha-value>)',
          700: 'rgb(var(--t-stone-700) / <alpha-value>)',
          800: 'rgb(var(--t-stone-800) / <alpha-value>)',
        },
        orange: {
          50: 'rgb(var(--t-amber-50) / <alpha-value>)',
          800: 'rgb(var(--t-amber-800) / <alpha-value>)',
          900: 'rgb(var(--t-amber-900) / <alpha-value>)',
        },
        yellow: {
          100: 'rgb(var(--t-brand-100) / <alpha-value>)',
          700: 'rgb(var(--t-brand-700) / <alpha-value>)',
          900: 'rgb(var(--t-brand-900) / <alpha-value>)',
        },
        teal: { 700: 'rgb(var(--t-forest) / <alpha-value>)' },
        cyan: { 800: 'rgb(var(--t-forest-deep) / <alpha-value>)' },
        blue: {
          50: 'rgb(var(--t-blue-50) / <alpha-value>)',
          700: 'rgb(var(--t-blue-700) / <alpha-value>)',
          800: 'rgb(var(--t-blue-800) / <alpha-value>)',
        },
        purple: { 400: 'rgb(var(--t-mute-dim) / <alpha-value>)' },
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(42,34,29,0.10), 0 4px 16px -4px rgba(42,34,29,0.08)',
        'brand': '0 2px 6px -1px rgba(177,135,57,0.30), 0 10px 28px -10px rgba(122,90,34,0.35)',
        'card': '0 1px 2px rgba(42,34,29,0.06), 0 8px 24px -10px rgba(42,34,29,0.10)',
        'elevated': '0 4px 12px -2px rgba(42,34,29,0.12), 0 12px 40px -8px rgba(42,34,29,0.14)',
        'float': '0 8px 30px -4px rgba(42,34,29,0.20), 0 20px 60px -12px rgba(42,34,29,0.16)',
        'inner-soft': 'inset 0 2px 6px rgba(42,34,29,0.10)',
        'brass-glow': '0 0 0 1px rgba(177,135,57,0.35), 0 6px 24px -8px rgba(177,135,57,0.28)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"CS Display Serif"', '"Songti SC"', 'STSong', '"Noto Serif CJK SC"', 'serif'],
        serifcn: ['"CS Display Serif"', '"Songti SC"', 'STSong', '"Noto Serif CJK SC"', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        'display-lg': ['clamp(2rem, 4vw, 2.75rem)', { lineHeight: '1.16', letterSpacing: '-0.015em' }],
        'display-md': ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'eyebrow':  ['0.6875rem', { lineHeight: '1.5', letterSpacing: '0.16em' }],
        '2xs':      ['0.75rem', { lineHeight: '1.125rem' }],
        '3xs':      ['0.75rem', { lineHeight: '1rem' }],
        'price-sm': ['1.375rem', { lineHeight: '1.5rem', letterSpacing: '-0.02em' }],
        'price-md': ['2rem',     { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        'price-lg': ['2.5rem',   { lineHeight: '2.75rem', letterSpacing: '-0.03em' }],
        'card-title': ['0.9375rem', { lineHeight: '1.35rem' }],
      },
      borderRadius: { '2xl': '0.75rem', '3xl': '1.25rem', '4xl': '1.75rem' },
      keyframes: {
        'fade-in-up': { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'slide-up': { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        'slide-down': { '0%': { opacity: '0', transform: 'translateY(-8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'shimmer': { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        // 时长全部落在 50ms 网格（motion-consistency 闸）；曲线只用在册四条
        'fade-in-up': 'fade-in-up 400ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 250ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slide-up 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-down': 'slide-down 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'shimmer': 'shimmer 1500ms linear infinite',
      },
    },
  },
  plugins: [],
}
