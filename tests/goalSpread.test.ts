/**
 * 长目标分布 · 天数上限（2026-10-07 RAY 实测「长目标把空闲时间排满」）
 * ------------------------------------------------------------
 * 旧实现 days.map 给**每个有空天**都排一块（600 分钟 ÷ 7 天 = 天天 85 分钟，
 * 视觉上空闲全被吃掉）。新口径：**大块少天**——
 *   · 天数 = 够装预算的最少天数（单块目标 90 分钟，硬顶 MAX_BLOCK=120）；
 *   · 600 分钟 → 5 天 × 120（周末留白）；225 分钟 → 3 天 × 75。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decomposeGoal, goalTasksOf } from '@/features/activity/goalDecompose';
import type { Goal, GoalPrefs } from '@/features/activity/goalStore';

const TERM = '2026-08-31';
const goal: Goal = {
  id: 'g1', title: '测试目标', emoji: '🎯', kind: 'study', category: 'academic',
  dueAt: '2026-10-31', totalHours: 10,
};
const prefs = {
  freeDays: [1, 2, 3, 4, 5, 6, 7],
  focusMinutes: 40,
  timeOfDay: 'evening',
  parallelCount: 1,
  weeklyCaps: { studyMin: 600, activityMin: 300 },
} as unknown as GoalPrefs;

function run(budget: number) {
  const { tasks } = decomposeGoal(goal, 6, TERM, prefs, {}, budget);
  return tasks.map((t) => t.durationMin ?? 0);
}

test('600 分钟预算 → 5 天 × 120（不再天天见，周末留白）', () => {
  const mins = run(600);
  assert.equal(mins.length, 5);
  for (const m of mins) assert.ok(m <= 120, `单块 ${m} 超 120 硬顶`);
  assert.ok(mins.reduce((a, b) => a + b, 0) >= 570, '总量不被天数上限过度砍');
});

test('225 分钟预算 → 2 天大块（占天最少，宁大勿碎）', () => {
  const mins = run(225);
  assert.equal(mins.length, 2);
  for (const m of mins) assert.ok(m <= 120);
  assert.ok(mins.reduce((a, b) => a + b, 0) >= 210);
});

test('小预算 → 至少 1 块（不消失）', () => {
  const mins = run(30);
  assert.equal(mins.length, 1);
  assert.ok(mins[0] >= 25);
});

test('多目标错开天（2026-10-07 RAY「只排最优先的目标」）', () => {
  const goals: Goal[] = [
    { id: 'a', title: 'A', emoji: '🎯', kind: 'study', category: 'academic', priority: 5, dueAt: '2026-10-31', totalHours: 12 },
    { id: 'b', title: 'B', emoji: '📖', kind: 'study', category: 'academic', priority: 4, dueAt: '2026-12-19', totalHours: 8 },
  ];
  const { tasks } = goalTasksOf(goals, 6, TERM, prefs, {}, undefined, null, null);
  const dayOf = (t: { id: string }) => { const m = /-d(\d+)$/.exec(t.id); return m ? Number(m[1]) : -1; };
  const aDays = tasks.filter((t) => t.id.startsWith('goal-a-')).map(dayOf);
  const bDays = tasks.filter((t) => t.id.startsWith('goal-b-')).map(dayOf);
  assert.ok(aDays.length > 0 && bDays.length > 0, '两个目标都应有任务');
  assert.ok(bDays.every((d) => !aDays.includes(d)), `低优先目标应避开高优先的天（A=${aDays} B=${bDays}）`);
});
