/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 「上理生活助手 · USST」—— 卡通奶油风设计系统
        // 关键词：chill · 有趣 · 贴纸手账 · 奶油底 + 上理红主色 + 马卡龙辅助色
        ink: { DEFAULT: '#2b2420', soft: '#5c534c', faint: '#9c918a' },
        paper: { DEFAULT: '#fff6e9', card: '#ffffff', line: '#f0e4d0' },
        // 上理红（微调更亮更跳，官方红保留在 dark）
        brand: { DEFAULT: '#d43a45', dark: '#a6192e', bright: '#ef5b63', light: '#fde3e5' },
        // 马卡龙辅助色（贴纸 / 标签 / 课程分类）
        butter: { DEFAULT: '#f5b840', light: '#fdeecb' },
        mint: { DEFAULT: '#4db98a', light: '#d9f2e6' },
        sky: { DEFAULT: '#4a9fe0', light: '#dcebfa' },
        coral: { DEFAULT: '#f07e88', light: '#fde6e8' },
        grape: { DEFAULT: '#9d7bf2', light: '#ece4fd' },
        silver: { DEFAULT: '#9ba0a6', light: '#eef0f2' },
        gold: { DEFAULT: '#b8860b', light: '#fbf3e2' },
        ok: { DEFAULT: '#2f9e6e', light: '#e3f6ec' },
        warn: { DEFAULT: '#d97a16', light: '#fdf0e0' },
        danger: { DEFAULT: '#c9414b', light: '#fde6e8' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', 'sans-serif'],
        display: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '22px' },
      // boxShadow 改在 src/index.css 的 @layer utilities 里手写定义，
      // 避免与 .sticker 组件类同名导致 PostCSS 解析边界问题
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
