/**
 * Golden 对照器（T1.6 / A4）—— `docs/scheduler-v2-spec.md` §10.4 第 3 条入口
 *
 * 用法（在仓库根目录）：
 *   node --import ./tests/register.mjs tests/golden-compare.ts
 *
 * 对每个快照逐条核验：
 *   ⓪ **基线可复现**：用 `schedule.ts` 重跑同一输入，块内容须与快照一致
 *       （防「有人偷偷改了旧引擎」→ 那样 golden 就不再是基准了）
 *   ① **AC-2 构造等价**：新引擎 `planWeekV2` 的块内容 === 快照（id 不参与）
 *   ② **AC-1 硬约束**：新引擎 `hardViolations === 0`
 *   ③ **AC-3 目标更优**：`cost_v2 <= cost_baseline`
 *
 * 退出码：全过 = 0；任一 FAIL = 1；**没有快照** = 0（属正常前置态：尚未拍摄）。
 *
 * ⚠️ 新引擎入口（`src/lib/planner/index.ts::planWeekV2`）在 T1.4 才落地。
 *    本文件用**动态导入 + 变量说明符**，因此：入口不在 → 自动降级为「只做 ⓪」，
 *    并把 ①②③ 标成 SKIP（而不是崩掉或假通过）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WeekPlan } from '@/types';
import { buildGoldenInput, goldenInputByName, transferProviderOf } from './golden-inputs.ts';
import { defaultEvalContext, diffJson, hardViolations, normalizePlan, planMetrics } from './golden-lib.ts';
import { buildWeekPlan, toPlanRequest } from '@/lib/planner/schedule.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'golden');

/** 新引擎入口（T1.4 产出）。用变量说明符 → 不存在时是运行期异常，可被捕获降级 */
const PLANNER_ENTRY = '../src/lib/planner/index.ts';

type PlanWeekV2 = (req: unknown) => unknown;
type Status = 'PASS' | 'FAIL' | 'SKIP';

interface Row {
  name: string;
  baseline: Status;
  ac2: Status;
  ac1: Status;
  ac3: Status;
  detail: string[];
}

interface NewEngine {
  planWeekV2: PlanWeekV2 | null;
  construct: PlanWeekV2 | null;
  reason: string;
}

/**
 * 载入新引擎。
 *
 * ⚠️ AC-2 的比对对象是 **`construct`**（构造阶段），不是 `planWeekV2`：
 *    规格书 §9-T1.1 的原话是「`construct` 输出的块集合与旧引擎逐块一致」，
 *    而 `planWeekV2` 多了 improve（允许把块挪到更优位置，AC-3 正是为此）。
 *    拿迭代后的计划去断言「逐块一致」会变成「improve 必须什么都不做」——那是错误的口径。
 *    取不到 `construct` 时退回 `planWeekV2` 并**在报告里注明**。
 */
async function loadNewEngine(): Promise<NewEngine> {
  try {
    const mod = (await import(/* @vite-ignore */ PLANNER_ENTRY)) as Record<string, unknown>;
    const v2 = typeof mod.planWeekV2 === 'function' ? (mod.planWeekV2 as PlanWeekV2) : null;
    const cst = typeof mod.construct === 'function' ? (mod.construct as PlanWeekV2) : null;
    if (!v2 && !cst) return { planWeekV2: null, construct: null, reason: `${PLANNER_ENTRY} 未导出 planWeekV2 / construct` };
    return { planWeekV2: v2, construct: cst, reason: '' };
  } catch (e) {
    return {
      planWeekV2: null, construct: null,
      reason: `${PLANNER_ENTRY} 尚不存在（T1.4 未落地）：${(e as Error).message.split('\n')[0]}`,
    };
  }
}

/** 从新引擎返回值里取 `WeekPlan`（容忍 `{plan}` 包裹或裸计划两种形态） */
function extractPlan(res: unknown): WeekPlan | null {
  if (!res || typeof res !== 'object') return null;
  const maybe = res as { plan?: unknown; blocks?: unknown };
  if (Array.isArray(maybe.blocks)) return res as WeekPlan;
  if (maybe.plan && Array.isArray((maybe.plan as WeekPlan).blocks)) return maybe.plan as WeekPlan;
  return null;
}

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

async function main(): Promise<number> {
  if (!existsSync(GOLDEN_DIR)) {
    console.log(`ℹ 还没有 golden 快照目录（${GOLDEN_DIR}）——先跑 golden-snapshot.ts。跳过。`);
    return 0;
  }
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.log('ℹ 还没有 golden 快照（tests/golden/*.json）。');
    console.log('  这是**正常前置态**：快照必须在 CY 的 PR 合入 dev 后、于唯一基准上「只拍一次」。');
    console.log('  等合入后执行：node --import ./tests/register.mjs tests/golden-snapshot.ts');
    return 0;
  }

  const eng = await loadNewEngine();
  const planWeekV2 = eng.planWeekV2;
  if (!planWeekV2 && !eng.construct) {
    console.log(`⚠ 新引擎不可用 → AC-1/2/3 记为 SKIP。原因：${eng.reason}`);
    console.log('  （这不算失败：P1 尚在实现中，本文件先做「基线可复现」这一项。）\n');
  }

  const rows: Row[] = [];
  let failed = 0;

  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    const snap = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8'));
    const g = goldenInputByName(name);
    const row: Row = { name, baseline: 'PASS', ac2: 'SKIP', ac1: 'SKIP', ac3: 'SKIP', detail: [] };

    if (!g) {
      row.baseline = 'FAIL';
      row.detail.push(`快照 ${name} 在 GOLDEN_INPUTS 里找不到对应语料 —— 语料被删/改名了？`);
      rows.push(row);
      failed += 1;
      continue;
    }

    // ⓪ 基线可复现
    const { plan: baseToday } = buildWeekPlan(buildGoldenInput(g));
    const drift = diffJson(normalizePlan(baseToday), snap.blocks);
    if (drift) {
      row.baseline = 'FAIL';
      row.detail.push(`基线已漂移（旧引擎输出 ≠ 快照）：\n${drift}`);
    }

    const ctx = defaultEvalContext(g.weekNo, g.policy);
    const baseMetrics = planMetrics(baseToday, ctx);

    // ② AC-2 构造等价 —— 对象是 `construct`（T1.1）
    const ac2Fn = eng.construct ?? planWeekV2;
    if (ac2Fn) {
      try {
        const built = eng.construct
          ? ac2Fn(toPlanRequest(buildGoldenInput(g)))
          : ac2Fn({
            schedule: g.schedule, weekNo: g.weekNo, policy: g.policy,
            scenarios: g.scenarios, tasks: g.tasks ?? [], transfer: transferProviderOf(g),
          });
        const builtPlan = extractPlan(built);
        if (!builtPlan) {
          row.ac2 = 'FAIL';
          row.detail.push('AC-2 拿不到计划对象（返回值既不是 WeekPlan 也不是 {plan}）');
        } else {
          const d2 = diffJson(snap.blocks, normalizePlan(builtPlan));
          row.ac2 = d2 ? 'FAIL' : 'PASS';
          if (d2) row.detail.push(`AC-2 构造不等价：\n${d2}`);
          if (!eng.construct) {
            row.detail.push('（注意：本环境取不到 `construct`，AC-2 退回用 planWeekV2 比对 —— 口径偏严）');
          }
        }
      } catch (e) {
        row.ac2 = 'FAIL';
        row.detail.push(`AC-2 抛错：${(e as Error).message}`);
      }
    }

    // ①③ AC-1 / AC-3 —— 对象是迭代后的计划（`planWeekV2`）
    if (planWeekV2) {
      let newPlan: WeekPlan | null = null;
      try {
        newPlan = extractPlan(planWeekV2({
          schedule: g.schedule,
          weekNo: g.weekNo,
          policy: g.policy,
          scenarios: g.scenarios,
          tasks: g.tasks ?? [],
          transfer: transferProviderOf(g),
        }));
      } catch (e) {
        row.ac1 = 'FAIL';
        row.ac3 = 'FAIL';
        row.detail.push(`新引擎抛错：${(e as Error).message}`);
      }

      if (newPlan) {
        // AC-1
        const hv = hardViolations(newPlan);
        row.ac1 = hv.total === 0 ? 'PASS' : 'FAIL';
        if (hv.total !== 0) {
          row.detail.push(`AC-1 硬约束违反 ${hv.total}（重叠 ${hv.overlaps} / 迟到转场 ${hv.lateTransfers}）`);
        }

        // AC-3
        const newMetrics = planMetrics(newPlan, ctx);
        row.ac3 = newMetrics.cost <= baseMetrics.cost + 1e-9 ? 'PASS' : 'FAIL';
        if (row.ac3 === 'FAIL') {
          row.detail.push(`AC-3 未更优：cost_v2=${newMetrics.cost.toFixed(2)} > cost_base=${baseMetrics.cost.toFixed(2)}`);
        }
      }
    }

    if ([row.baseline, row.ac2, row.ac1, row.ac3].includes('FAIL')) failed += 1;
    rows.push(row);
  }

  // —— 报告 ——
  console.log(`${pad('快照', 24)} ${pad('⓪基线', 8)} ${pad('AC-2构造', 9)} ${pad('AC-1硬约束', 11)} AC-3预算`);
  console.log('-'.repeat(70));
  for (const r of rows) {
    console.log(`${pad(r.name, 24)} ${pad(r.baseline, 8)} ${pad(r.ac2, 9)} ${pad(r.ac1, 11)} ${r.ac3}`);
    for (const d of r.detail) console.log(`    ↳ ${d.replace(/\n/g, '\n      ')}`);
  }
  console.log('-'.repeat(70));

  if (planWeekV2 || eng.construct) {
    console.log(failed === 0
      ? `✓ 全部通过（${rows.length} 个快照）`
      : `✗ ${failed}/${rows.length} 个快照未通过`);
  } else {
    const bad = rows.filter((r) => r.baseline === 'FAIL').length;
    console.log(bad === 0
      ? `◐ 基线可复现通过（${rows.length}/${rows.length}）；AC-1/2/3 待 T1.4 落地后启用`
      : `✗ 基线漂移 ${bad}/${rows.length} —— 旧引擎已被改动，golden 失去基准意义`);
  }

  return failed === 0 ? 0 : 1;
}

void main().then((code) => process.exit(code));
