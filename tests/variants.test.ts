/**
 * F4 · A2 一键多方案 + D10 目标函数补项（引擎核）—— 验收测试（2026-10-24）
 * ============================================================
 * 守五件事（对应技术方案 F4 行的验收 a-e）：
 *   ① 零漂移钥匙：DEFAULT_WEIGHTS 两新键 === 0，且显式传 0 与不传逐字节一致；
 *   ② 计价有牙齿：blockLengthOverrun / windowViolation 权重 >0 时必须计入
 *      （RV 对偶：evaluate 未接线则恒 0 → 本组恰红）；
 *   ③ 三档变体：balanced/compact/relaxed 齐产、balanced ≡ 基准、
 *      studyMin 单调（compact ≥ balanced ≥ relaxed，非严格）；
 *   ④ 预算闸纯函数边界（0/599 放行，600/601 拒）；
 *   ⑤ PLAN_VARIANTS=0 逃生门：开关关 → 无变体，基准结果不受影响。
 * 现场验收 e（DEFAULT 改 1 → 存量 golden 红）在批次收尾以 live 变异实测留痕
 * （BLOCKERS F4 收尾条），不在本文件自动化（golden 冻结语料只增不改）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PlanRequest } from '@/lib/planner/model.ts';
import { DEFAULT_WEIGHTS, VARIANT_PRESETS } from '@/lib/planner/model.ts';
import { evaluate, STUDY_TIER_CAP_MIN } from '@/lib/planner/objective.ts';
import { solveWeek } from '@/lib/planner/solver.ts';
import { planWeek, variantGate } from '@/lib/planner/planWeek.ts';
import type { Schedule, PhasePolicy } from '@/types';

/* ---------- 合成语料（确定性；晚间窗口提交项 × 高自习目标） ---------- */
const schedule: Schedule = { termStart: '2026-09-14', totalWeeks: 20, courses: [] };
const policy: PhasePolicy = {
  dailyStudyMin: 240, maxBlockMin: 90, blankRatio: 0.25,
  eveningAllowed: true, weekendWork: true, studyPlaces: ['图书馆'],
};
function makeReq(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    schedule, weekNo: 4, policy,
    commits: [{
      id: 'c-sprint', title: '数学冲刺', kind: 'study', effortMin: 300,
      splittable: true, weeks: [4], window: { fromMin: 1080, toMin: 1320 },
    }],
    ...over,
  };
}
const evalCtx = (req: PlanRequest, weights: Parameters<typeof evaluate>[1]['weights']) => ({
  weekNo: req.weekNo, policy: req.policy, weights, commits: req.commits,
});

test('F4-① 零漂移钥匙：DEFAULT 两新键 === 0；显式 0 与不传逐字节一致', () => {
  assert.equal(DEFAULT_WEIGHTS.blockLengthOverrun, 0);
  assert.equal(DEFAULT_WEIGHTS.windowViolation, 0);
  const base = solveWeek(makeReq());
  const explicitZero = solveWeek(makeReq({ weights: { blockLengthOverrun: 0, windowViolation: 0 } }));
  assert.equal(JSON.stringify(base.plan), JSON.stringify(explicitZero.plan), '权重 0 必须与缺省逐字节一致');
  assert.equal(base.diagnostics.cost.total, explicitZero.diagnostics.cost.total);
  // 默认路径的两新分项精确为 0（0 × 有限数 = +0）
  assert.equal(base.diagnostics.cost.parts.blockLengthOverrun, 0);
  assert.equal(base.diagnostics.cost.parts.windowViolation, 0);
});

test('F4-② 计价有牙齿：把一块软自习拉伸 +60min → 超档分项精确 +60（线性计价）', () => {
  const req = makeReq();
  const solved = solveWeek(req);
  // 语料的软自习块普遍 ≥50min（policy.maxBlockMin=90），拉伸线性放大超档量
  const target = solved.plan.blocks.find((b) => b.kind === 'study' && b.endMin - b.startMin >= STUDY_TIER_CAP_MIN);
  assert.ok(target, '语料应存在 ≥ 档位上限的软自习块');
  const stretched = {
    ...solved.plan,
    blocks: solved.plan.blocks.map((b) => (b.id === target.id ? { ...b, endMin: b.endMin + 60 } : b)),
  };
  const baseEv = evaluate(solved.plan, evalCtx(req, { ...DEFAULT_WEIGHTS }));
  const withW = evaluate(stretched, evalCtx(req, { ...DEFAULT_WEIGHTS, blockLengthOverrun: 1 }));
  // 增量断言：raw 增量 === +60（raw 与权重无关）；权重 1 时分项 === raw；权重 0 时分项恒 0
  assert.equal(withW.raw.blockOverrunMin - baseEv.raw.blockOverrunMin, 60);
  assert.equal(withW.blockLengthOverrun, withW.raw.blockOverrunMin, '权重 1 ⇒ 分项 === 原始量');
  assert.equal(evaluate(stretched, evalCtx(req, { ...DEFAULT_WEIGHTS })).blockLengthOverrun, 0);
});

test('F4-② 计价有牙齿：窗口违约（把提交项块挪出晚间窗口 → 计 1 次）', () => {
  const req = makeReq();
  const solved = solveWeek(req);
  const cblock = solved.plan.blocks.find((b) => b.id.includes('-c-sprint'));
  assert.ok(cblock, '提交项应产块（语义键内嵌 commitId）');
  const moved = {
    ...solved.plan,
    blocks: solved.plan.blocks.map((b) =>
      b.id === cblock.id ? { ...b, startMin: 480, endMin: 480 + (b.endMin - b.startMin) } : b),
  };
  const withW = evaluate(moved, evalCtx(req, { ...DEFAULT_WEIGHTS, windowViolation: 1 }));
  assert.ok(withW.raw.windowViolations >= 1, '挪出窗口必须被计数（关联口径同 improve）');
  assert.equal(withW.windowViolation, withW.raw.windowViolations);
  assert.equal(evaluate(moved, evalCtx(req, { ...DEFAULT_WEIGHTS })).windowViolation, 0);
});

test('F4-③ 三档变体：齐产、balanced ≡ 基准、studyMin 单调（compact ≥ balanced ≥ relaxed）', async () => {
  const result = await planWeek(makeReq({ variants: true }));
  const vs = result.variants;
  assert.ok(vs && vs.length === 3, `应产三档，实得 ${vs?.length}`);
  assert.deepEqual(vs.map((v) => v.id), ['balanced', 'compact', 'relaxed']);
  assert.deepEqual(vs.map((v) => v.label), ['均衡', '紧凑', '松弛']);
  assert.equal(JSON.stringify(vs[0].plan), JSON.stringify(result.plan), 'balanced ≡ 基准（零额外求解）');
  // 单调性（非严格 ≥；工作单 b 项口径）
  const studyMin = (p: typeof result.plan) => p.stats.studyMin;
  assert.ok(studyMin(vs[0].plan) >= studyMin(vs[2].plan), `balanced(${studyMin(vs[0].plan)}) ≥ relaxed(${studyMin(vs[2].plan)})`);
  assert.ok(studyMin(vs[1].plan) >= studyMin(vs[2].plan), `compact(${studyMin(vs[1].plan)}) ≥ relaxed(${studyMin(vs[2].plan)})`);
  // 预设完整性：三档与 VARIANT_PRESETS 一致
  assert.deepEqual(VARIANT_PRESETS.map((p) => p.id), ['balanced', 'compact', 'relaxed']);
});

test('F4-④ 预算闸边界：0/599 放行，600/601 拒（纯函数，确定性）', () => {
  assert.equal(variantGate(0), true);
  assert.equal(variantGate(599), true);
  assert.equal(variantGate(600), false);
  assert.equal(variantGate(601), false);
});

test('F4-⑤ 逃生门：PLAN_VARIANTS=0 → 不产变体，基准结果原样；删除后恢复', async () => {
  process.env.PLAN_VARIANTS = '0';
  try {
    const off = await planWeek(makeReq({ variants: true }));
    assert.equal(off.variants, undefined, '开关关 → 无变体（一键回旧）');
  } finally {
    delete process.env.PLAN_VARIANTS;
  }
  const on = await planWeek(makeReq({ variants: true }));
  assert.equal(on.variants?.length, 3, '开关恢复 → 三档齐产');
  // 未请求变体 → 基准行为（零开销）
  const plain = await planWeek(makeReq());
  assert.equal(plain.variants, undefined);
});

/* ---------- F4 收尾批（④UI）接线锁：读源码断言（RV：摘条件/改键名→恰红，实测留痕） ---------- */
const here = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel: string) => readFileSync(join(here, rel), 'utf8');

test('F4-④ UI 接线：hook 请求变体并按周持久化选择（usst.variant-{weekNo}）；出口替换仅非基准变体', () => {
  const hook = srcOf('../src/features/week/useWeekPlan.ts');
  assert.match(hook, /variants: true,/, 'hook 必须向引擎请求变体（PLAN_VARIANTS=0 时引擎自行降级）');
  assert.match(hook, /`usst\.variant-\$\{weekNo\}`/, '选择按周持久化（键名口径与工作单一致）');
  assert.match(hook, /v\.id === variantId && v\.id !== 'balanced'/, '出口替换只对非基准变体生效（balanced≡基准零漂移）');
});

test('F4-④ UI 接线：切换器只在三档齐备时渲染（变体缺席=零漂移逃生，不占视觉位）', () => {
  const wv = srcOf('../src/features/week/WeekPlanView.tsx');
  assert.match(wv, /variants\.length === 3 &&/, '渲染守卫：变体缺席时整段不渲染');
  assert.match(wv, /testId="variant-switch"/, '切换器带 testid（E2E/走查锚点）');
  assert.match(wv, /value=\{variantId\}/, '受控组件接 hook 的选择态');
});
