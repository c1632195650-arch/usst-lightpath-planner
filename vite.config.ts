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
    // ⚠️ 关掉自动开浏览器：CY 常用手机连本机调试（LAN IP），自动弹浏览器会抢窗口。
    open: false,
    // 课表解析（2026-10-08 接线）：解析包已归拢进主仓库（server/timetable_parser/），
    // 由 FastAPI（server/app.py，dev 下与 /api 同一个 8001 实例）提供 /courses 与
    // /api/import_pdf —— 不再需要另跑一个独立的 8765 服务。
    // 走代理后浏览器看到的是同源 /timetable/*，天然绕开 CORS 与 OPTIONS 预检。
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
      // 🔴 /api 代理（2026-10-06，为手机走 LAN IP 调试而加）
      //
      // 背景：手机用 `http://<LAN-IP>:5173/m.html` 打开dev server 时，页面 origin
      // 是 `http://192.168.110.x:5173`，若让 fetch 直连 `http://<LAN-IP>:8001` 就是**跨域**，
      // 而后端 CORS 白名单只放行 localhost:5173/5174（见 server/app.py::_CORS_DEFAULT）
      // → 手机端所有 API 会失败。
      //
      // 走代理后，浏览器看到的是**同源** `/api/*`，由 dev server 转发到 127.0.0.1:8001，
      // 既绕开 CORS，也不用给 Python 端加任何跨域头。
      // ⚠️ 目标是 **127.0.0.1** 而不是 LAN IP：代理在开发机内部转发，用回环最稳
      //    （LAN IP 在部分 Windows 防火墙配置下会被拦，且多绕一层网卡）。
      //
      // 与移动端 API 基址的关系：`lib/api.ts` 的 `VITE_MOBILE_API_BASE` 留空
      // （= 同源相对路径）即可自动吃到这条代理；**不要**在起 dev 时设成 LAN IP。
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/timetable': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/timetable/, ''),
      },
      // W4b-B（CY 拍板 2026-10-07「B 全收敛 + 补 preview 代理」）：API 基址兜底改
      // 同源 '' 后，preview / 纯静态托管必须有这条代理 —— 否则同源 /api 会 404。
      // 目标与 dev 代理同口（127.0.0.1:8001）。
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
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
