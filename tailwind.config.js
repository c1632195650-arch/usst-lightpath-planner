/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 「光溯」设计系统 —— 浅色主题，暖橙主色 + 雾蓝辅色
        ink: { DEFAULT: '#1f2937', soft: '#4b5563', faint: '#78716c' },
        paper: { DEFAULT: '#faf8f5', card: '#ffffff', line: '#e7e2da' },
        brand: { DEFAULT: '#c2410c', light: '#fff7ed', dark: '#9a3412' },
        accent: { DEFAULT: '#1d4ed8', light: '#eff6ff' },
        ok: { DEFAULT: '#15803d', light: '#f0fdf4' },
        warn: { DEFAULT: '#b45309', light: '#fffbeb' },
        danger: { DEFAULT: '#b91c1c', light: '#fef2f2' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
      borderRadius: { card: '12px' },
    },
  },
  plugins: [],
};
