/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 品牌柿色 —— 保留「柿子黄」这一唯一品牌资产，不下沉色相。
        // 2026-10-22 对比度重整的结论：问题从来不是黄太亮，而是**黄上放了白字**（1.92:1）。
        // 铁律（index.css 里由 .btn-primary/.pill-active 落地）：
        //   柿色底 ⇒ 配墨字 ink（#1c1917 on #eab308 = 9.12:1，AAA）
        //   要白字 ⇒ 走深绿 dark-600（9.11:1）或墨底 ink（17.49:1）
        brand: {
          50:  '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',  // 主色 柿子黄（承载**墨字**）
          600: '#ca8a04',  // hover
          700: '#a16207',
          800: '#854d0e',
          900: '#713f12',
        },
        dark: {
          500: '#1a2e05',  // 深绿 accent
          600: '#14532d',
          700: '#052e16',
        },
        surface: {
          DEFAULT: '#fafaf9',
          warm: '#f8f7f4',
          card: '#ffffff',
        },
        // 墨：全站唯一「深底」与「正文最重」的落点（暖黑，不用纯黑，与暖白页底同色温）
        ink: {
          DEFAULT: '#1c1917',
          soft: '#292524',
          mute: '#57534e',
        },
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(0,0,0,0.06), 0 4px 16px -4px rgba(0,0,0,0.04)',
        // 品牌投影：落影带柿色相而非中性灰（卡片浮起时影子里有颜色）
        'brand': '0 2px 6px -1px rgba(202,138,4,0.30), 0 10px 28px -10px rgba(180,83,9,0.34)',
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 6px 24px -6px rgba(0,0,0,0.06)',
        'elevated': '0 4px 12px -2px rgba(0,0,0,0.08), 0 12px 40px -8px rgba(0,0,0,0.1)',
        'float': '0 8px 30px -4px rgba(0,0,0,0.12), 0 20px 60px -12px rgba(0,0,0,0.08)',
        'inner-soft': 'inset 0 2px 6px rgba(0,0,0,0.04)',
      },
      fontFamily: {
        // 排版双声部：display = Bricolage Grotesque（自托管 woff2，CSP font-src 'self' 合规）
        // 正文 = 系统中文字体栈（中文无廉价自托管方案，混排时 display 只管数字与拉丁）
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
      },
      fontSize: {
        // 字阶系统（1.2 三度 modular scale，四舍五入到 2px 网格）
        'display-xl': ['3.25rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'display-lg': ['2.25rem', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        'display-md': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'eyebrow':  ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.16em' }],
        // 微字阶（2026-10-23 收编）：全站原本散落 41 处 text-[10px]/text-[11px] 任意值，
        // 两者只差 1px ⇒ 不是设计选择而是随手写。登记成具名档后"标签级"只有这两档，
        // 且 3xs 是**下限**（实测再小中文就不可读：本轮消灭了两处 9px）。
        '2xs':      ['0.6875rem', { lineHeight: '1rem' }],      // 11px 密集标签/角标
        '3xs':      ['0.625rem', { lineHeight: '0.875rem' }],   // 10px 下限：极紧凑徽章
        // 价格三档：卡片 / 页面汇总 / 详情主价。金额是本站第一信息，
        // 尺寸必须成体系（旧写法是 22/32/40px 三个 arbitrary 值各写一次）。
        'price-sm': ['1.375rem', { lineHeight: '1.5rem', letterSpacing: '-0.02em' }],
        'price-md': ['2rem',     { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        'price-lg': ['2.5rem',   { lineHeight: '2.75rem', letterSpacing: '-0.03em' }],
        // 卡片商品名：比 sm(14) 重一档、比 base(16) 轻一档，全站唯一用途
        'card-title': ['0.9375rem', { lineHeight: '1.35rem' }],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
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
