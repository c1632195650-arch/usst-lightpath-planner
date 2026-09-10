/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 奶油底色承接大面积内容，珊瑚与深红只用于操作、选中和重点信息。
        ink: { DEFAULT: '#4b0000', soft: '#7a3028', faint: '#a66b5b' },
        paper: { DEFAULT: '#fff8ec', card: '#ffffff', line: '#ffdead' },
        brand: { DEFAULT: '#b22222', dark: '#8b0000', bright: '#ff6347', light: '#ffe4b5' },
        sky: { DEFAULT: '#ff7f50', light: '#fff0dc' },
        ok: { DEFAULT: '#15803d', light: '#edfdf3' },
        warn: { DEFAULT: '#b45309', light: '#fff7ed' },
        danger: { DEFAULT: '#b91c1c', light: '#fef2f2' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', 'sans-serif'],
        display: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '16px' },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        floatY: {
          '0%,100%': { transform: 'translateY(0) rotate(-2deg)' },
          '50%': { transform: 'translateY(-10px) rotate(2deg)' },
        },
        wobble: {
          '0%,100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(.6)' },
          '70%': { transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-4deg)' },
          '50%': { transform: 'rotate(4deg)' },
        },
        bounceSoft: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        spinSlow: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp .5s ease-out both',
        'fade-in': 'fadeIn .6s ease-out both',
        'float-y': 'floatY 4s ease-in-out infinite',
        wobble: 'wobble 3s ease-in-out infinite',
        'pop-in': 'popIn .5s cubic-bezier(.34,1.56,.64,1) both',
        wiggle: 'wiggle 2.2s ease-in-out infinite',
        'bounce-soft': 'bounceSoft 2.4s ease-in-out infinite',
        'spin-slow': 'spinSlow 18s linear infinite',
      },
    },
  },
  plugins: [],
};
