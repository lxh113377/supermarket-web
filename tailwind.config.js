/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',  // 主色 暖黄
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
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(0,0,0,0.06), 0 4px 16px -4px rgba(0,0,0,0.04)',
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 6px 24px -6px rgba(0,0,0,0.06)',
        'elevated': '0 4px 12px -2px rgba(0,0,0,0.08), 0 12px 40px -8px rgba(0,0,0,0.1)',
        'float': '0 8px 30px -4px rgba(0,0,0,0.12), 0 20px 60px -12px rgba(0,0,0,0.08)',
        'inner-soft': 'inset 0 2px 6px rgba(0,0,0,0.04)',
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
        'bounce-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.3s ease both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.16,1,0.3,1) both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down': 'slide-down 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'bounce-soft': 'bounce-soft 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
