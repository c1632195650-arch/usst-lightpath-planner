/**
 * P1 求解器编排验收（T1.4 / AC-1 / AC-3 / AC-5 / AC-6）
 * ============================================================
 * 依据：规格书 §9-T1.4、§10.1 AC-1 / AC-3 / AC-5 / AC-6、§10.4。
 *
 * 验的是**对外入口** `index.ts::planWeekV2`（不是内部函数）：
 *   AC-1 硬约束零违反 · AC-3 成本不劣于旧引擎 · AC-5 硬块不动 · AC-6 确定性
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Course, CourseTimeSlot, PhasePolicy, Schedule } from '@/types';
import { planWeekV2, stablePlanJson, buildWeekPlan } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { resolveLockLevel } from '@/lib/planner/model.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { defaultEvalContext, hardViolations, planMetrics } from './golden-lib.ts';

/* ============================================================
 * AC-1 / AC-3：全部 golden 输入
 * ========================================================== */

test('AC-1：planWeekV2 在全部 golden 输入上硬约束零违反', () => {
  for (const g of GOLDEN_INPUTS) {
    const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
    const hv = hardViolations(res.plan);
    assert.equal(hv.total, 0, `${g.name} 硬约束违反 ${hv.total}（重叠 ${hv.overlaps} / 迟到 ${hv.lateTransfers}）`);
    assert.equal(res.diagnostics.hardViolations, 0, `${g.name} 诊断里的 hardViolations 应为 0`);
  }
});

test('AC-3：planWeekV2 成本不劣于旧引擎（cost_v2 <= cost_baseline）', () => {
  for (const g of GOLDEN_INPUTS) {
    const ctx = defaultEvalContext(g.weekNo, g.policy);
    const baseline = planMetrics(buildWeekPlan(buildGoldenInput(g)).plan, ctx).cost;
    const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
    const v2 = planMetrics(res.plan, ctx).cost;
    assert.ok(
      v2 <= baseline + 1e-9,
      `${g.name} 变差了：cost_v2=${v2.toFixed(3)} > baseline=${baseline.toFixed(3)}`,
    );
  }
});

/* ============================================================
 * AC-5：硬块（课程 / 用户锁定）improve 前后坐标不变
 * ========================================================== */

test('AC-5：improve 前后，hard 块的坐标一律不变', () => {
  for (const g of GOLDEN_INPUTS) {
    const req = toPlanRequest(buildGoldenInput(g));
    // greedy = 只构造（即 improve 的输入），lns = 构造 + 改进（即输出）
    const before = planWeekV2({ ...req, config: { solver: 'greedy' } }).plan;
    const after = planWeekV2({ ...req, config: { solver: 'lns' } }).plan;

    const hardKeys = before.blocks
      .filter((b) => resolveLockLevel(b) === 'hard')
      .map((b) => `${b.id}@${b.dayOfWeek}:${b.startMin}-${b.endMin}`)
      .sort();

    const afterHard = new Map(
      after.blocks
        .filter((b) => resolveLockLevel(b) === 'hard')
        .map((b) => [b.id, `${b.id}@${b.dayOfWeek}:${b.startMin}-${b.endMin}`]),
    );
    for (const k of hardKeys) {
      const id = k.slice(0, k.indexOf('@'));
      assert.equal(afterHard.get(id), k, `${g.name} 的硬块 ${id} 被移动了`);
    }
  }
});

/* ============================================================
 * AC-6：确定性（elapsedMs 除外）
 * ========================================================== */

test('AC-6：同输入两次 planWeekV2，稳定序列化结果逐字节相同', () => {
  for (const g of GOLDEN_INPUTS) {
    const req = toPlanRequest(buildGoldenInput(g));
    const a = stablePlanJson(planWeekV2(req));
    const b = stablePlanJson(planWeekV2(req));
    assert.equal(a === b, true, `${g.name} 两次运行不稳定`);
  }
});

/* ============================================================
 * 诊断与模式开关
 * ========================================================== */

test('diagnostics：7 项分项之和 === total（AC-3 的恒等式）', () => {
  const g = GOLDEN_INPUTS[0];
  const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
  const parts = res.diagnostics.cost.parts;
  const sum = Object.values(parts).reduce((n, v) => n + v, 0);
  assert.ok(
    Math.abs(sum - res.diagnostics.cost.total) < 1e-6,
    `分项之和 ${sum} ≠ total ${res.diagnostics.cost.total}`,
  );
});

test("solver='greedy' 不跑改进（iterations = 0），且成本不低于 lns", () => {
  const g = GOLDEN_INPUTS.find((x) => x.name === 'week-06-practice');
  assert.ok(g);
  const req = toPlanRequest(buildGoldenInput(g));
  const greedy = planWeekV2({ ...req, config: { solver: 'greedy' } });
  const lns = planWeekV2({ ...req, config: { solver: 'lns' } });
  assert.equal(greedy.diagnostics.solver, 'greedy');
  assert.equal(greedy.diagnostics.iterations, 0);
  assert.ok(
    lns.diagnostics.cost.total <= greedy.diagnostics.cost.total + 1e-9,
    `lns(${lns.diagnostics.cost.total}) 不该比 greedy(${greedy.diagnostics.cost.total}) 差`,
  );
});

test('nextRolling：产出跨周状态（loadByDow 有 7 天槽位、upcoming 按紧迫度降序）', () => {
  const g = GOLDEN_INPUTS[0];
  const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
  assert.equal(res.nextRolling.loadByDow.length, 8, 'loadByDow 需要 0..7 共 8 个槽位（0 占位）');
  assert.equal(res.nextRolling.recentLoad.length, 7, 'recentLoad 是周一到周日 7 项');
  for (let i = 1; i <= 7; i += 1) {
    assert.ok(res.nextRolling.loadByDow[i] > 0, `周 ${i} 的负荷应大于 0`);
  }
  const ups = res.nextRolling.upcoming.map((u) => u.urgency);
  assert.deepEqual(ups, [...ups].sort((a, b) => b - a), 'upcoming 应按 urgency 降序');
});

test('提交项依赖成环：不崩、如实报 error、仍能排出计划', () => {
  const sched: Schedule = {
    semesterName: '2026-2027-1', semesterType: 'autumn', termStart: '2026-09-07',
    totalWeeks: 20, source: 'demo',
    courses: [] as Course[],
  };
  const policy: PhasePolicy = {
    dailyStudyMin: 0, maxBlockMin: 60, blankRatio: 0.1,
    eveningAllowed: true, weekendWork: false, studyPlaces: [],
  };
  const res = planWeekV2({
    schedule: sched, weekNo: 4, policy, commits: [
      { id: 'X', title: '循环一', kind: 'activity', effortMin: 30, deps: ['Y'] },
      { id: 'Y', title: '循环二', kind: 'activity', effortMin: 30, deps: ['X'] },
    ],
  });
  assert.ok(res.plan.issues.some((i) => i.level === 'error' && i.message.includes('成环')),
    `应报出依赖成环：${JSON.stringify(res.plan.issues)}`);
  assert.ok(res.plan.blocks.length > 0, '有环也要能排出计划（降级忽略环上依赖）');
});

/* ============================================================
 * 兼容入口：buildWeekPlan 仍可用且内容等价
 * ========================================================== */

test('兼容入口 buildWeekPlan 与 construct 同源（块内容一致）', () => {
  for (const g of GOLDEN_INPUTS) {
    const input = buildGoldenInput(g);
    const legacy = buildWeekPlan(input).plan;
    const greedy = planWeekV2({ ...toPlanRequest(input), config: { solver: 'greedy' } }).plan;
    const key = (p: typeof legacy) => p.blocks
      .map((b) => `${b.dayOfWeek}|${b.startMin}|${b.endMin}|${b.kind}|${b.title}|${b.place ?? ''}`)
      .sort().join('\n');
    assert.equal(key(legacy), key(greedy), `${g.name}：旧入口与新入口 greedy 模式块内容不一致`);
  }
});

const _unusedCourseSlot: CourseTimeSlot | null = null;
void _unusedCourseSlot;
