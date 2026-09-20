/**
 * 转场收敛 · 对真实后端的端到端验证（**需要后端在跑**）
 * ============================================================
 * 用法：
 *   ① 先起后端：`cd server && python -m uvicorn app:app --port 8000`
 *   ② 再跑：`node --import ./tests/register.mjs tests/p2-live-transfer.ts`
 *
 * 为什么必须是独立脚本而不是 `node --test` 用例：
 *   · 它依赖一个**外部进程**（后端）。放进主测试套件会让「后端没起」
 *     表现为「测试挂了」，从而掩盖真实的回归 —— 这是最坏的一种噪声。
 *   · 它要打印人类可读的收敛过程（每轮问了几条、命中几条、哪些路没问到），
 *     这些是给人看的诊断，不是给 CI 判红绿的断言。
 *
 * 脚本仍然返回非零退出码表示「引擎侧逻辑有问题」；
 * 「后端没起」用**明确的跳过**表示（退出码 0 + 一行说明），不伪装成失败。
 *
 * ⚠️ 本脚本**不使用** `lib/api.ts`（它顶层读 `import.meta.env`，Node 里跑不了），
 *    而是直接用 `fetch` 打 HTTP —— 这也顺带证明「收敛核心不依赖 Vite 环境」。
 */
import { planWeek } from '@/lib/planner/planWeek.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { planWeekV2 } from '@/lib/planner/index.ts';
import {
  collectTransferPairs, collectCandidatePairs, MAX_TRANSFER_ROUNDS,
} from '@/lib/planner/transferConverge.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8000';

async function health(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 真实后端的批量问路 —— 与 `transfer.ts::fetchRouteBatch` 做同一件事。
 * 手写一份是为了让脚本不依赖 `lib/api.ts`（Vite 专有 `import.meta.env`）。
 */
async function liveFetch(pairs: Array<[string, string]>) {
  if (pairs.length === 0) return {};
  const r = await fetch(`${API}/api/route/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await r.json()) as { routes?: Record<string, { minutes: number; reliable?: boolean } | null> };
  const routes = data.routes ?? {};
  const hits = Object.values(routes).filter((v) => v && typeof v.minutes === 'number').length;
  console.log(`     ↳ 问 ${pairs.length} 条，后端命中 ${hits} 条实测`);
  return routes;
}

async function main(): Promise<void> {
  if (!(await health())) {
    console.log(`⏭  跳过：后端未连通（${API}）。先运行 \`cd server && python -m uvicorn app:app --port 8000\``);
    process.exit(0);
  }
  console.log(`✓ 后端连通：${API}\n`);

  const G = GOLDEN_INPUTS.find((x) => x.name === 'week-12-crosscampus');
  if (!G) throw new Error('找不到 week-12-crosscampus 语料');
  const req = toPlanRequest(buildGoldenInput(G));

  /* ── 单遍基线（全兜底估算） ── */
  const single = planWeekV2(req);
  const singleEst = single.plan.blocks.filter((b) => b.transfer && !b.transfer.reliable).length;
  const adjacentPairs = collectTransferPairs(single.plan.blocks);
  const candidatePairs = collectCandidatePairs(single.plan.blocks);
  console.log('── 单遍基线（全兜底估算）────────────────────');
  console.log(`   块数              ${single.plan.blocks.length}`);
  console.log(`   不可靠转场        ${singleEst} 处`);
  console.log(`   相邻跨点对        ${adjacentPairs.length} 条`);
  console.log(`   候选点对（方法B） ${candidatePairs.length} 条`);
  console.log('');

  /* ── planWeek（收敛循环 + 真实后端） ── */
  console.log('── planWeek（收敛循环 + 真实后端）───────────');
  const t0 = Date.now();
  const res = await planWeek(req, { fetchRoutes: liveFetch });
  const ms = Date.now() - t0;

  const bodies = res.plan.blocks.filter((b) => b.transfer);
  const reliable = bodies.filter((b) => b.transfer?.reliable).length;
  const uncovered = res.transferUncovered ?? [];

  console.log('');
  console.log(`   收敛轮数        ${res.transferRounds ?? '(未走收敛循环)'} / 上限 ${MAX_TRANSFER_ROUNDS}`);
  console.log(`   未覆盖路对      ${uncovered.length} 条`);
  for (const u of uncovered.slice(0, 8)) console.log(`                    · ${u}`);
  if (uncovered.length > 8) console.log(`                    … 另 ${uncovered.length - 8} 条`);
  console.log(`   转场总数        ${bodies.length} · 实测 ${reliable} · 估算 ${bodies.length - reliable}`);
  console.log(`   硬约束违反      ${res.diagnostics.hardViolations}`);
  console.log(`   耗时            ${ms} ms`);
  if (res.notes.length > 0) {
    console.log('   说明:');
    for (const n of res.notes) console.log(`     · ${n}`);
  }

  /* ── 引擎侧硬断言（与后端数据无关的部分） ── */
  const problems: string[] = [];
  if (res.diagnostics.hardViolations !== 0) {
    problems.push(`硬约束违反 ${res.diagnostics.hardViolations}（应为 0）`);
  }
  if ((res.transferRounds ?? 0) < 2) {
    problems.push(`轮数 ${res.transferRounds}（至少应跑 2 轮：用兜底排 → 用实测重排）`);
  }
  if ((res.transferRounds ?? 0) > MAX_TRANSFER_ROUNDS + 1) {
    problems.push(`轮数 ${res.transferRounds} 超过上限 + 终版重算（${MAX_TRANSFER_ROUNDS + 1}）`);
  }
  if (reliable === 0) {
    problems.push('一条实测转场都没用上 —— 收敛循环可能没走到真实后端');
  }
  if (uncovered.length > 0 && (res.transferRounds ?? 0) < 2) {
    problems.push('有未覆盖的路对，但只跑了 1 轮 —— 应当继续补问');
  }

  console.log('');
  if (problems.length > 0) {
    console.log('❌ 引擎侧有问题：');
    for (const p of problems) console.log(`   · ${p}`);
    process.exit(1);
  }
  console.log('✅ 收敛循环在真实后端上工作正常。');
  if (uncovered.length > 0) {
    console.log(`   注：仍有 ${uncovered.length} 条路对未覆盖 —— 那是后端 OSM 路网数据里缺这些点，`);
    console.log('       不是引擎的问题。页面会如实提示「个别转场时间为估算值」。');
  }
}

main().catch((e) => {
  console.error('脚本自身异常：', e);
  process.exit(1);
});
