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
