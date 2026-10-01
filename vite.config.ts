import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 注意：本项目 package.json 是 "type": "module"，
// 所以这里不能用 __dirname（ESM 下未定义），必须用 import.meta.url。
// 这是新手最常踩的坑之一，别改成 path.resolve(__dirname, ...)。
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // 🔧 只扫应用入口做预构建：Newton/ 下的两份技术验证 Demo import 了未安装的
  //    `three`，默认全量扫 html 入口会让干净检出起不了 dev server（vite build 不受影响，
  //    所以 CI 发现不了）。见 DETAIL.md §C。
  optimizeDeps: { entries: ['index.html'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // 不自动弹系统默认浏览器（RAY 2026-09-26：每次启动都蹦 Edge 窗口很扰人，测试时手动开 localhost:5173 即可）。
    open: false,
    // /api 代理目标可用 VITE_API_PROXY_TARGET 覆盖（2026-10-02 delta 融合：此前硬编码 8000，
    // 换端口跑后端时 /api/auth/me 静默失败 → 前端 auth 恒 offline → 登录页永远不出现）。
    // 课表解析仍由仓库根 serve.py 提供（默认 127.0.0.1:8000）；账号+kv 在 app.py（PORT 可调）。
    // dev 模式走代理后浏览器看到的是同源 /api/*，天然绕开 CORS、Cookie 正常携带。
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
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
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
