import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// 注意：本项目 package.json 是 "type": "module"，
// 所以这里不能用 __dirname（ESM 下未定义），必须用 import.meta.url。
// 这是新手最常踩的坑之一，别改成 path.resolve(__dirname, ...)。
import { fileURLToPath } from 'node:url';

/**
 * 梨宝脑分流（2026-10-07 · 路线 1「连 CY 服务器」）
 * ============================================================
 * CY 侧把梨宝的「大脑」调试在服务端：LLM 对话管理器 / 记忆系统 /
 * 联网搜索 / 路线规划（server/ 是一整套 FastAPI，本地 serve.py 没有
 * 这些端点）。本配置支持把这些端点单独转发到 CY 的服务器，其余
 * /api（账号 / 云同步 / 课表解析）继续走本地 serve.py —— 两边各管各的。
 *
 * 用法：仓库根建 `.env.local`（已 gitignore），写一行：
 *   CY_API_TARGET=http://<CY服务器的IP或域名>:<端口>
 *   · 填了 → 下面 CY_BRAIN_PREFIXES 命中的请求转发给 CY，启动时会打印提示；
 *   · 不填 / 删掉 → 全部回本地 serve.py，行为与从前一致。
 *
 * 生产模式（build + serve.py）不走本代理 —— 同样的分流已加在 serve.py
 * （CY_BRAIN_PREFIXES 块，待 CY 审查），双击哪个 bat 都生效。
 */
const CY_BRAIN_PREFIXES = [
  '/api/chat',   // 梨宝对话（LLM 大脑 + 流式）
  '/api/memory', // 记忆系统（facts 增删改查 / reset）
  '/api/plan',   // 计划理解 / 计划评估（plan_dialog / plan_review）
  '/api/search', // 校园信息检索
  '/api/health', // LLM 在线状态（本地 serve.py 无此端点，转发后 lbaoHealth 才有真数据）
  '/api/weather',
  '/api/poi',
  '/api/nearby',
  '/api/route',  // 路线规划（含 /api/route/batch）
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cyTarget = (env.CY_API_TARGET ?? '').trim().replace(/\/+$/, '');
  // 更具体的前缀排在前面（vite 代理按键顺序 startsWith 命中），
  // 未命中 CY 前缀的 /api/* 落回本地 serve.py。
  const cyBrainProxy = cyTarget
    ? Object.fromEntries(
        CY_BRAIN_PREFIXES.map((p) => [p, { target: cyTarget, changeOrigin: true }]),
      )
    : {};
  if (cyTarget) {
    console.log(`[vite] 梨宝脑分流已启用 → ${cyTarget}（端点前缀：${CY_BRAIN_PREFIXES.join(' ')}）`);
  } else {
    console.log('[vite] 梨宝脑分流未启用（未配置 CY_API_TARGET），全部 /api 走本地 serve.py');
  }

  return {
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
        ...cyBrainProxy,
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
        ...cyBrainProxy,
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
  };
});
