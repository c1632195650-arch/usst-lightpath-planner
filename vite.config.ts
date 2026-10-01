import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 注意：本项目 package.json 是 "type": "module"，
// 所以这里不能用 __dirname（ESM 下未定义），必须用 import.meta.url。
// 这是新手最常踩的坑之一，别改成 path.resolve(__dirname, ...)。
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // 不自动弹系统默认浏览器（RAY 2026-09-26：每次启动都蹦 Edge 窗口很扰人，测试时手动开 localhost:5173 即可）。
    open: false,
    // 课表解析 + 数据库 + 账号都由仓库根 serve.py 提供（默认 127.0.0.1:8000）。
    // dev 模式走代理后浏览器看到的是同源 /timetable/*、/api/*，天然绕开 CORS。
    // 旧版独立课表服务(8765)已退役：timetable_parser 包已归拢进 server/，由 serve.py 进程内加载。
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
