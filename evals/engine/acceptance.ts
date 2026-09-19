/**
 * 排程引擎 · 独立验收台架（2026-09-18，CY 侧）
 * ============================================================
 * 立场：引擎的**实现**归 B，但**验收**不该也交出去。
 * 本文件刻意**不复用** `tests/golden-lib.ts` 的校验辅助（normalizePlan / hardViolations /
 * planMetrics）—— 复用等于用被测方自己的尺子量自己：尺子坏了，问题会被一起藏住。
 * 只借两样：① `tests/golden-inputs.ts` 的冻结语料（输入）② 引擎入口。

 * 检查的是**不变量**，不是具体排布 —— 引擎怎么排是它的自由，但下面几条任何一版实现都不许破：
 *
 *   I1 几何合法     startMin < endMin，且落在 [0, 1440)
 *   I2 日内不重叠    同一天任意两块区间不相交（铁律③：不得出现物理上不可能的排布）
 *   I3 课程不漏      本周有课的课程，每门至少出现一个 course 块
 *   I4 转场合规      transfer.minutes 是整数（铁律① Math.ceil）且 ≤ 实际间隔（铁律②）
 *   I5 确定性        同一输入跑两次可比较内容完全一致（防「优化」引入随机/时钟依赖）
 *
 * 三个变体（缺一不可，第一版只跑 as-is 时转场恒为 0，I4 形同虚设）：
 *   as-is      按语料声明（多为 transfer:'none'）
 *   campus     走 `campusFallbackTransfer`（只在**跨校区**时才给分钟数）
 *   transfers  走 `planWeek` + **注入确定性 provider**（每个不同地点对都给 7min）
 *              —— 只有这一档才真正验到铁律①②
 *
 * 用法
 *   node --import ./scripts/register-alias.mjs evals/engine/acceptance.ts --runs 5
 *   python evals/run.py --suite engine         # 由台架统一调用（npm run eval:engine）
 */
import { buildWeekPlan, toPlanRequest } from '@/lib/planner/schedule.ts';
import { DEFAULT_SOLVER_CONFIG } from '@/lib/planner/model.ts';
import { planWeek } from '@/lib/planner/planWeek.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from '../../tests/golden-inputs.ts';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

type AnyRec = Record<string, any>;
const argv = process.argv.slice(2);
const flag = (n: string, d = '') => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] ?? true) : d;
};
const RUNS = Math.max(2, Number(flag('--runs', '5')));
const OUT = String(flag('--json', ''));
const UPDATE = argv.includes('--update-baseline');
const BASELINE = 'evals/runs/engine_baseline.json';

/** 注入用确定性转场：任何两个不同地点都给 7 分钟（纯函数，无网络、无随机） */
const STUB_MIN = 7;
const stubProvider = (from: string, to: string) =>
  from && to && from !== to
    ? { minutes: STUB_MIN, source: 'eval-stub', reliable: true }
    : null;

/* ---------------- 我自己的可比较口径 ---------------- */
function canon(plan: AnyRec) {
  const blocks = (plan?.blocks ?? [])
    .map((b: AnyRec) => [b.dayOfWeek, b.startMin, b.endMin, b.kind, b.title, b.place ?? null])
    .sort((a: any[], b: any[]) => a[0] - b[0] || a[1] - b[1] || String(a[4]).localeCompare(String(b[4])));
  return JSON.stringify({ weekNo: plan?.weekNo, blocks });
}

function issuesOf(plan: AnyRec) {
  const out = { error: 0, warn: 0, info: 0 };
  for (const i of plan?.issues ?? []) {
    if (i?.level === 'error') out.error += 1;
    else if (i?.level === 'warn') out.warn += 1;
    else out.info += 1;
  }
  return out;
}

/* ---------------- 不变量检查（独立实现） ---------------- */
function checkInvariants(plan: AnyRec, input: AnyRec, opts: { coverage?: boolean } = {}) {
  const bad: { code: string; detail: string }[] = [];
  const blocks: AnyRec[] = plan?.blocks ?? [];

  for (const b of blocks) {
    if (!(b.startMin < b.endMin)) bad.push({ code: 'I1', detail: `${b.title} 区间非法 ${b.startMin}-${b.endMin}` });
    if (b.startMin < 0 || b.endMin > 1440) bad.push({ code: 'I1', detail: `${b.title} 越出一天` });
  }

  const byDay = new Map<number, AnyRec[]>();
  for (const b of blocks) byDay.set(b.dayOfWeek, [...(byDay.get(b.dayOfWeek) ?? []), b]);
  for (const [day, arr] of byDay) {
    arr.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < arr.length; i += 1) {
      if (arr[i].startMin < arr[i - 1].endMin) {
        bad.push({ code: 'I2', detail: `周${day} 重叠：${arr[i - 1].title}(→${arr[i - 1].endMin}) / ${arr[i].title}(${arr[i].startMin}→)` });
      }
    }
  }

  const weekNo = input?.weekNo;
  const need = new Set<string>();
  for (const c of input?.schedule?.courses ?? []) {
    for (const s of c.slots ?? []) if (!s.weeks || s.weeks.includes(weekNo)) need.add(c.id);
  }
  const have = new Set(blocks.filter((b) => b.kind === 'course' && b.courseId).map((b) => b.courseId));
  for (const id of need) if (!have.has(id)) bad.push({ code: 'I3', detail: `课程 ${id} 有课但无块` });

  let transfers = 0;
  let tight = 0;
  let maxTransfer = 0;
  let placePairs = 0;      // 相邻且两块都有地点、且地点不同的对数
  let placePairsWithHint = 0;
  for (const [day, arr] of byDay) {
    arr.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < arr.length; i += 1) {
      const prev = arr[i - 1];
      const cur = arr[i];
      const gap = cur.startMin - prev.endMin;

      // 🔴 语义（2026-09-18 用原文核对过）：`block.transfer` 描述的是**进入本块**的转场
      //    （fromPlace=上一处、toPlace=本块）。所以**只看 cur.transfer** ——
      //    第一版写了 `cur.transfer ?? prev.transfer`，把「上一块进馆的转场」算到下一块头上，
      //    凭空造出 11 处假违规。（教训：假红先查断言，别急着报 bug。）
      const t = cur.transfer;

      // I6 转场覆盖率：两块都有地点且不同 → 应当有转场提示。
      // ⚠️ 只在 `transfers` 档检查：另两档（as-is / campus）本就不产生转场提示
      //    （campus 仅跨校区给值），无条件检查会 100% 误报。
      if (opts.coverage && prev.place && cur.place && prev.place !== cur.place) {
        placePairs += 1;
        if (t) placePairsWithHint += 1;
        else bad.push({ code: 'I6', detail: `周${day} ${prev.place}→${cur.place} 无转场提示（转场覆盖缺失）` });
      }

      if (!t) continue;
      transfers += 1;
      const m = t.minutes;
      if (!Number.isInteger(m)) bad.push({ code: 'I4', detail: `周${day} 转场分钟非整数 ${m}（铁律①）` });
      maxTransfer = Math.max(maxTransfer, typeof m === 'number' ? m : 0);
      if (typeof m === 'number' && gap < m) {
        bad.push({ code: 'I4', detail: `周${day} 间隔 ${gap}min < 转场 ${m}min（${prev.title}→${cur.title}）` });
      }
      // I7 内部一致性：引擎自己算的 slackMin 应等于 实际余量 − 转场分钟
      if (typeof t.slackMin === 'number' && typeof m === 'number' && t.slackMin !== gap - m) {
        bad.push({ code: 'I7', detail: `周${day} slackMin=${t.slackMin} 但 实际 gap−转场 = ${gap - m}（转场数据与实际排布不一致）` });
      }
      if (t.tight) tight += 1;
    }
  }

  return { bad, transfers, tight, maxTransfer, placePairs, placePairsWithHint };
}

/* ---------------- 跑一个场景（异步：第三档走 planWeek） ---------------- */
async function runVariant(spec: AnyRec, variant: string) {
  const times: number[] = [];
  let plan: AnyRec | null = null;
  let firstCanon = '';
  let deterministic = true;
  let err = '';

  for (let i = 0; i < RUNS; i += 1) {
    const input = buildGoldenInput(spec);   // 纯工厂；**不要** structuredClone（含函数）
    const t0 = process.hrtime.bigint();
    try {
      if (variant === 'transfers') {
        const res = await planWeek(toPlanRequest(input), { transferFactory: async () => stubProvider });
        plan = res.plan;
      } else {
        plan = buildWeekPlan(input).plan;
      }
    } catch (e: any) {
      err = String(e?.message ?? e).slice(0, 200);
      break;
    }
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    const c = canon(plan);
    if (i === 0) firstCanon = c;
    else if (c !== firstCanon) deterministic = false;
  }

  const name = spec.name as string;
  if (err || !plan) return { name, variant, violations: [{ code: 'E0', detail: err || 'no plan' }] };

  const { bad, transfers, tight, maxTransfer, placePairs, placePairsWithHint } =
    checkInvariants(plan, buildGoldenInput(spec), { coverage: variant === 'transfers' });
  if (!deterministic) bad.push({ code: 'I5', detail: '同一输入两次运行结果不一致' });

  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const days = new Set((plan.blocks ?? []).map((b: AnyRec) => b.dayOfWeek));

  return {
    name,
    variant,
    violations: bad,
    metrics: {
      blocks: plan.blocks?.length ?? 0,
      courseBlocks: (plan.blocks ?? []).filter((b: AnyRec) => b.kind === 'course').length,
      daysCovered: days.size,
      transfers,
      tightTransfers: tight,
      maxTransferMin: maxTransfer,
      transferCoverage: placePairs ? +(placePairsWithHint / placePairs).toFixed(3) : null,
      studyMin: plan.stats?.studyMin,
      blankMin: plan.stats?.blankMin,
      issues: issuesOf(plan),
      ms: { p50: +p(0.5).toFixed(2), p95: +p(0.95).toFixed(2), max: +Math.max(...times).toFixed(2) },
      determinism: deterministic,
      // 相对基线是否明显变慢（供 run.py --suite engine 报警；噪声大故阈值取 1.5×）
      slow: false,
    },
  };
}

/* ---------------- 主流程 ---------------- */
const VARIANTS = ['as-is', 'campus', 'transfers'];
const jobs = GOLDEN_INPUTS.flatMap((g) => VARIANTS.map((variant) => ({ spec: g as AnyRec, variant })));

const results: AnyRec[] = [];
for (const { spec, variant } of jobs) {
  try {
    results.push(await runVariant(spec, variant));
  } catch (e: any) {
    results.push({ name: spec.name, variant, violations: [{ code: 'E9', detail: String(e?.message ?? e).slice(0, 200) }] });
  }
}

let totalBad = 0;
console.log(`\n🧪 排程引擎独立验收｜场景 ${GOLDEN_INPUTS.length} × ${VARIANTS.length} 档 = ${results.length} 次验收`
  + `｜每档跑 ${RUNS} 次｜评分口径 ${DEFAULT_SOLVER_CONFIG.scoring}\n`);
for (const r of results) {
  const n = r.violations?.length ?? 0;
  totalBad += n;
  const m = r.metrics;
  const mark = n === 0 ? '✅' : '❌';
  if (!m) {
    console.log(`${mark} ${r.name} [${r.variant}]  ← ${r.violations?.[0]?.detail ?? '失败'}`);
    continue;
  }
  console.log(
    `${mark} ${r.name} [${r.variant}]｜块 ${m.blocks}（课 ${m.courseBlocks}）｜天 ${m.daysCovered}`
      + `｜转场 ${m.transfers}（紧 ${m.tightTransfers}/最长 ${m.maxTransferMin}min）`
      + `｜issues e${m.issues.error}/w${m.issues.warn}/i${m.issues.info}`
      + `｜p50 ${m.ms.p50}ms p95 ${m.ms.p95}ms｜${m.determinism ? '确定性✓' : '确定性✗'}`,
  );
  for (const v of r.violations ?? []) console.log(`     ❌ [${v.code}] ${v.detail}`);
}

const payload = {
  ts: new Date().toISOString(),
  // ⚠️ 记录**评分口径**：aware 档每次求解比 legacy 慢 ~2.7×（评测要逐对问 provider），
  // 基线里的毫秒数**只在同一口径下可比** —— 不记这个字段，下次对比就是苹果比橘子。
  scoring: DEFAULT_SOLVER_CONFIG.scoring,
  runs: RUNS,
  variants: VARIANTS,
  results,
  totals: {
    violations: totalBad,
    hardIssues: results.reduce((s, r) => s + (r.metrics?.issues?.error ?? 0), 0),
    tightTransfers: results.reduce((s, r) => s + (r.metrics?.tightTransfers ?? 0), 0),
    transfersSeen: results.reduce((s, r) => s + (r.metrics?.transfers ?? 0), 0),
    determinism: results.every((r) => r.metrics?.determinism !== false),
  },
};

const cur = {
  ts: payload.ts,
  scoring: payload.scoring,   // 基线必须自带口径标记（毫秒只在同口径下可比）
  perScenario: Object.fromEntries(results.map((r) => [`${r.name}[${r.variant}]`, r.metrics ?? null])),
  totals: payload.totals,
};
if (existsSync(BASELINE)) {
  const old = JSON.parse(readFileSync(BASELINE, 'utf8'));
  console.log('\n== 与引擎基线对比（只列变化）==');
  let shown = 0;
  for (const [name, m] of Object.entries(cur.perScenario) as [string, any][]) {
    const o = old.perScenario?.[name];
    if (!m || !o) continue;
    const bits: string[] = [];
    for (const k of ['blocks', 'studyMin', 'blankMin', 'transfers']) {
      if (typeof o[k] === 'number' && typeof m[k] === 'number' && o[k] !== m[k]) {
        bits.push(`${k} ${o[k]}→${m[k]}${m[k] > o[k] ? '↑' : '↓'}`);
      }
    }
    const p95o = o.ms?.p95;
    const p95n = m.ms?.p95;
    if (typeof p95o === 'number' && typeof p95n === 'number') {
      const slowed = p95n > p95o * 1.5;
      if (slowed) {
        (m as any).slow = true;   // 让 run.py 能数出「变慢的场景数」
        bits.push(`p95 ${p95o}→${p95n}ms  ⚠️ 慢 50%+（噪声大；定论请用 --runs 9）`);
      }
    }
    if (bits.length) {
      console.log(`  ${name}：${bits.join('｜')}`);
      shown += 1;
    }
  }
  if (!shown) console.log('  （全部与基线一致）');
}
if (UPDATE || !existsSync(BASELINE)) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(cur, null, 1), 'utf8');
  console.log(`\n📌 引擎基线已${UPDATE ? '更新' : '建立'}：${BASELINE}`);
}
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');
  console.log(`明细：${OUT}`);
}

console.log(`\n结论：${totalBad === 0 ? '✅ 不变量全部通过（I1–I5）' : `❌ 共 ${totalBad} 处不变量违反`}`);
process.exit(totalBad === 0 ? 0 : 1);
