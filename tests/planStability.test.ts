/**
 * T9 测试：默认锁（「不改的块就是定住的」）
 * ============================================================
 * 用户的原话：「我不改它，那它不就是定住的吗？」
 * 这个直觉此前不成立 —— 引擎每次重排都从头构造，自排块全是 `free`（churn ×0），
 * 于是每次都可能大改。T9 在入口处给「上一版仍存在的块」注入 `soft` 锁。
 *
 * 这里测的是那个推导函数本身（确定性、优先级、例外），
 * 以及一条最关键的**回归守卫**：没有 `previousPlan` 时行为必须与以前完全一致
 * —— 那是 golden 快照能继续通过的前提。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDefaultSoftLocks, solveWeek } from '@/lib/planner/solver.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');

/** 造一个最小的「上一版计划」 */
function planWith(blocks) {
  return {
    weekNo: 1,
    blocks: blocks.map((b, i) => ({
      id: b.id, kind: b.kind ?? 'study', dayOfWeek: 1,
      startMin: 480 + i * 60, endMin: 540 + i * 60, title: b.id,
    })),
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
    issues: [],
  };
}

/* ============================================================
 * 一、computeDefaultSoftLocks
 * ========================================================== */

test('T9: 没有上一版计划 → 不注入任何锁（首次排程行为不变）', () => {
  assert.deepEqual(computeDefaultSoftLocks(undefined, undefined), {});
});

test('T9: 上一版里的非课程块全部注入 soft', () => {
  const plan = planWith([{ id: 'a', kind: 'study' }, { id: 'b', kind: 'meal' }]);
  assert.deepEqual(computeDefaultSoftLocks(plan, undefined), { a: 'soft', b: 'soft' });
});

test('T9: 课程块跳过（它的 hard 由 resolveLockLevel 推导，不该被降级）', () => {
  const plan = planWith([{ id: 'c1', kind: 'course' }, { id: 's1', kind: 'study' }]);
  const out = computeDefaultSoftLocks(plan, undefined);
  assert.equal(out.c1, undefined, '课程不该出现在注入表里');
  assert.equal(out.s1, 'soft');
});

test('T9: 用户显式锁的 hard 不会被降级成 soft', () => {
  const plan = planWith([{ id: 'a', kind: 'study' }, { id: 'b', kind: 'study' }]);
  const out = computeDefaultSoftLocks(plan, { a: 'hard', b: 'free' });
  assert.equal(out.a, undefined, '显式 hard 必须原样保留（优先级更高）');
  assert.equal(out.b, undefined, '显式 free 也不该被改成 soft —— 用户说了算');
});

test('T9: 空计划不报错', () => {
  assert.deepEqual(computeDefaultSoftLocks(planWith([]), undefined), {});
});

/* ============================================================
 * 二、回归守卫：首次排程（无 previousPlan）行为不变
 * ========================================================== */

test('T9 回归守卫: 无 previousPlan 时，结果与不传锁级别完全一致', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const a = solveWeek(req);
  const b = solveWeek({ ...req, lockLevels: undefined, lockedPlacements: undefined });
  assert.deepEqual(
    a.plan.blocks.map((x) => `${x.id}@${x.dayOfWeek}:${x.startMin}`),
    b.plan.blocks.map((x) => `${x.id}@${x.dayOfWeek}:${x.startMin}`),
    '首次排程不该因为 T9 产生任何差异',
  );
  assert.equal(a.diagnostics.churnMin, 0, '没有上一版时 churn 恒为 0');
});

test('T9: 传入上一版计划后，同输入的差异应为 0（默认就是稳的）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const r1 = solveWeek(req);
  const r2 = solveWeek({ ...req, previousPlan: r1.plan });
  assert.equal(r2.diagnostics.churnMin, 0,
    '确定性的引擎 + 默认 soft 锁，重排不应产生任何扰动');
});
