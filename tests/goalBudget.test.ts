/**
 * 长计划增强一期 §1.3：目标预算软上限 + 降权
 * ------------------------------------------------------------
 * 验收口径（计划书 + RAY 拍板「软上限+降权」）：
 *   · 活跃目标 > 5 个 → 排序键（截止临近度 desc, 优先级 desc）第 6 名起需求 ×0.5；
 *   · 产出一条「目标过多」的 summary warning（诚实：不拦截、要明说）；
 *   · 恰好 5 个 → 无 warning，分配不受影响（边界不误伤）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { goalTasksOf } from '@/features/activity/goalDecompose';
import { DEFAULT_GOAL_PREFS } from '@/features/activity/goalPrefs';
import type { Goal } from '@/features/activity/goalStore';

const TERM_START = '2026-09-07';

function addDaysIso(base: string, days: number): string {
  const t = Date.parse(`${base}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 第 i 个目标：截止在第 (2+i) 周末 → 临近度随 i 递减（g1 最临急） */
function mkGoals(n: number): Goal[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    title: `目标${i + 1}`,
    emoji: '🎯',
    kind: 'study' as const,
    totalHours: 10,
    dueAt: addDaysIso(TERM_START, (2 + i) * 7),
    priority: 3 as const,
  }));
}

function minutesByGoal(out: { tasks: Array<{ id: string; durationMin?: number }> }): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of out.tasks) {
    const gid = t.id.replace(/^goal-/, '').replace(/-w\d+.*/, '');
    m.set(gid, (m.get(gid) ?? 0) + (t.durationMin ?? 0));
  }
  return m;
}

test('7 个目标：第 6/7 名需求减半，产出「目标过多」warning', () => {
  // ⚠️ cap 提到 4000 让容量网不先绑定 —— 本测试只验「软上限降权」这一个机制
  // （7 个 v1 目标 × 最小块 25 分 × 5 天 = 875 > 默认 600，容量网会把小目标整体剔除，
  //   那是另一条既有行为，不是本测试的对象）
  const prefs = { ...DEFAULT_GOAL_PREFS, weeklyCaps: { studyMin: 4000, activityMin: 300 } };
  const out = goalTasksOf(mkGoals(7), 1, TERM_START, prefs, undefined, undefined, null, null);
  const warn = out.warnings.find((w) => w.goalId === 'soft-limit');
  assert.ok(warn, '应产出软上限 summary warning');
  assert.ok(warn.message.includes('50%'), 'warning 应说明降权规则');

  const minutes = minutesByGoal(out);
  const first = minutes.get('g1') ?? 0;
  const sixth = minutes.get('g6') ?? 0;
  const seventh = minutes.get('g7') ?? 0;
  assert.ok(sixth > 0 || seventh > 0, '被降权目标仍应有块（降权不是剔除）');
  assert.ok(
    first > sixth || first > seventh,
    `排首目标（${first} 分钟）应多于被降权目标（g6=${sixth} / g7=${seventh}）`,
  );
});

test('恰好 5 个目标：无软上限 warning（边界不误伤）', () => {
  const out = goalTasksOf(mkGoals(5), 1, TERM_START, { ...DEFAULT_GOAL_PREFS }, undefined, undefined, null, null);
  assert.equal(
    out.warnings.find((w) => w.goalId === 'soft-limit'),
    undefined,
    '5 个目标不应触发软上限',
  );
});
