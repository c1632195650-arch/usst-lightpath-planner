#!/usr/bin/env node
/**
 * e2e-offline-gate —— 离线 E2E 的自足运行器（口径③落地，2026-10-24 CY 拍板）
 * ============================================================
 * 背景：e2e-sched-session.mjs 需要一个**离线**（API_BASE 指向死端口）的前端实例，
 * 此前属"手动资产、不进门禁"（BLOCKERS 2026-10-02 先例：白天人工窗起隔离 vite）。
 * CY 于 2026-10-24 拍板口径③：重锚完成后**离线全绿纳入每批收尾门禁**。
 *
 * 本脚本把"起隔离实例 → 跑剧本 → 拆实例"封装为自足一步：
 *   · 专用端口 5178（--strictPort，撞车即失败不静默换口）；
 *   · VITE_API_BASE 指向 5999 死端口（离线口径，与 2026-10-24 差分归因批同法）；
 *   · 直接 spawn vite 的 node 入口（不经 npx/cmd 包装，kill 能杀干净）；
 *   · Playwright 浏览器缺失等环境问题 → exit 3（调用方按 WARN 处理，不判 FAIL）；
 *   · E2E 真跑且断言失败 → exit 1（门禁红）。
 *
 * 用法：node scripts/e2e-offline-gate.mjs            # gate_overnight 内部调用
 * 退出码：0 全绿；1 E2E 有失败；2 实例起不来；3 环境缺件（playwright/浏览器）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5178;
const DEAD_API = 'http://127.0.0.1:5999';
const VITE_JS = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const t0 = Date.now();
const log = (m) => console.log(`[e2e-gate ${(Date.now() - t0) / 1000 | 0}s] ${m}`);

// ── 前置：环境缺件快速判定（exit 3 = WARN 语义） ──
if (!existsSync(VITE_JS)) { console.error('[e2e-gate] vite 未安装（node_modules/vite 缺失）'); process.exit(3); }
{
  const r = spawnSync(process.execPath, ['--eval', "import('@playwright/test').then(()=>0,()=>process.exit(1))"], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('[e2e-gate] @playwright/test 不可用'); process.exit(3); }
}

// ── 起隔离离线实例（直接 node 入口，保证 kill 树干净） ──
log(`起离线 vite :${PORT}（API_BASE→${DEAD_API}）`);
const vite = spawn(process.execPath, [VITE_JS, '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  env: { ...process.env, VITE_API_BASE: DEAD_API },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});
let viteOut = '';
vite.stdout.on('data', (d) => { viteOut += d; });
vite.stderr.on('data', (d) => { viteOut += d; });
const cleanup = () => { try { vite.kill('SIGKILL'); } catch { /* 已退 */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// ── 就绪探测（net 连通） ──
const ready = await new Promise((resolve) => {
  const deadline = Date.now() + 40_000;
  const poll = () => {
    const s = net.connect(PORT, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => {
      s.destroy();
      if (vite.exitCode != null || vite.killed) return resolve(false);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(poll, 500);
    });
  };
  poll();
});
if (!ready) {
  console.error('[e2e-gate] ❌ 隔离实例未就绪（端口 ' + PORT + '），vite 输出尾：\n' + viteOut.split('\n').slice(-8).join('\n'));
  cleanup();
  process.exit(2);
}
log('实例就绪，跑离线剧本（e2e-sched-session，约 3–4 分钟）');

// ── 跑剧本 ──
const e2e = spawnSync(process.execPath, ['scripts/e2e-sched-session.mjs', `http://127.0.0.1:${PORT}`], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  timeout: 480_000,
});
const out = (e2e.stdout || '') + (e2e.stderr || '');
const pass = (out.match(/✓/g) || []).length;
const fail = (out.match(/✗/g) || []).length;

// 环境缺件识别（浏览器未装等）→ exit 3，不判 FAIL
if (e2e.status !== 0 && /Executable doesn't exist|playwright install|browserType\.launch/i.test(out)) {
  console.error('[e2e-gate] ⚠️ Playwright 浏览器缺件（需 npx playwright install）——按环境限制 WARN 处理');
  cleanup();
  process.exit(3);
}

console.log(out.split('\n').filter((l) => /✗|PASS|FAIL|全部|结果/.test(l)).slice(-8).join('\n'));
log(`剧本结束：pass=${pass} fail=${fail} exit=${e2e.status}`);
cleanup();
process.exit(e2e.status === 0 && fail === 0 ? 0 : 1);
