import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 注意：本项目 package.json 是 "type": "module"，
// 所以这里不能用 __dirname（ESM 下未定义），必须用 import.meta.url。
// 这是新手最常踩的坑之一，别改成 path.resolve(__dirname, ...)。
import { fileURLToPath } from 'node:url';
// 读 package.json 的 version，作为构建期常量注入（单一事实源，防"出包忘改版本号"）
import { readFileSync } from 'node:fs';

const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    // 移动端 F18 检查更新要比对"本APK 内置版本"与"服务器 /api/version"。
    // 🔴 此前该值硬编码在 useTodayData.ts，出包漏改 → 静默失效。注入后自动跟随 package.json。
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  // 🔧 只扫应用入口做预构建：Newton/ 下的两份技术验证 Demo import 了未安装的
  //    `three`，默认全量扫 html 入口会让干净检出起不了 dev server（vite build 不受影响，
  //    所以 CI 发现不了）。见 DETAIL.md §C。
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
  // 光溯移动端（2026-10-03）：m.html 独立入口 —— index.html 主流程零改动，
  // 多页 input 只加一行，主站构建产物不受影响（方案 §7.1）。
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        mobile: 'm.html',
      },
    },
  },
});
