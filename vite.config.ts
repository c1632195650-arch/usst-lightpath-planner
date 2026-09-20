import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 注意：本项目 package.json 是 "type": "module"，
// 所以这里不能用 __dirname（ESM 下未定义），必须用 import.meta.url。
// 这是新手最常踩的坑之一，别改成 path.resolve(__dirname, ...)。
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // 🔴 必须收窄依赖预构建的扫描入口：默认 Vite 会把仓库里**所有** .html 当入口扫，
  // 于是 Newton/光谱排程_技术验证Demo.html 里的 importmap（'three' → jsDelivr CDN）
  // 会被当成裸依赖去 node_modules 找，找不到就直接报错、dev server 起不来。
  // 该 Demo 是独立单文件原型（靠浏览器 importmap 自解析），本来就不该进 Vite 构建。
  // 症状具有欺骗性：`vite build` 一切正常，只有 dev server 挂 → CI 发现不了。
  optimizeDeps: { entries: ['index.html'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    open: true,
    // 课表解析服务（timetable_parser/server.py，默认跑在 127.0.0.1:8765）。
    // 走代理后浏览器看到的是同源 /timetable/*，天然绕开 CORS 与 OPTIONS 预检，
    // 不用给 Python 端加任何跨域头。想直连就设 VITE_TIMETABLE_BASE。
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
