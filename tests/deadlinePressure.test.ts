/**
 * 长计划增强一期 §1.1：截止压力传导
 * ------------------------------------------------------------
 * 验收口径（计划书）：
 *   · 同一目标第 1 周 vs 最后 1 周的需求预算差 ≥ 15%（实测 +40% 封顶）；
 *   · 无截止 / 无总量的目标行为不变（向后兼容硬不变量）；
 *   · 纯函数：周上下文由参数注入，引擎不读时钟。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deadlineProximity, weeklyDemandMin } from '@/features/activity/goalDecompose';
import { DEFAULT_GOAL_PREFS } from '@/features/activity/goalPrefs';
import type { Goal } from '@/features/activity/goalStore';

const TERM_START = '2026-09-07'; // 周一

function addDaysIso(base: string, days: number): string {
  const t = Date.parse(`${base}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function mkGoal(over: Partial<Goal>): Goal {
  return { id: 'g1', title: '测试目标', emoji: '🎯', kind: 'study', ...over };
}

const PREFS = { ...DEFAULT_GOAL_PREFS };

test('deadlineProximity：8 周线性窗口，本周截止 = 1，8 周外 = 0，无截止 = 0', () => {
  // dueAt = 2026-11-30 → 第 13 周
  const far = mkGoal({ dueAt: '2026-11-30' });
  assert.equal(deadlineProximity(far, 1, TERM_START), 0);        // 还剩 12 周
  assert.equal(deadlineProximity(far, 5, TERM_START), 0);        // 还剩 8 周 → 0
  assert.equal(deadlineProximity(far, 9, TERM_START), 0.5);      // 还剩 4 周
  assert.equal(deadlineProximity(far, 13, TERM_START), 1);       // 本周截止
  assert.equal(deadlineProximity(far, 14, TERM_START), 1);       // 已过期按 1
  assert.equal(deadlineProximity(mkGoal({}), 13, TERM_START), 0); // 无截止
});

test('v1 路径（无里程碑）：最后一周需求比第 1 周高 ≥ 15%（计划书验收）', () => {
  // 12 周后截止，10 小时总量，steady（缺省）节奏。
  // v1 语义 = 剩余总量均摊到剩余周（W = weeksLeft+1），临近度再乘增益。
  const goal = mkGoal({ totalHours: 10, dueAt: addDaysIso(TERM_START, 12 * 7) });
  const first = weeklyDemandMin(goal, 1, TERM_START, PREFS, null, null) as number;
  const last = weeklyDemandMin(goal, 13, TERM_START, PREFS, null, null) as number;
  // 第 1 周：L=12、W=13 → 600/13，p=0 → 无增益
  assert.ok(Math.abs(first - 600 / 13) < 1e-6, `第 1 周需求应为 600/13，实际 ${first}`);
  // 第 13 周：L=0、W=1 → 全部剩余 600，p=1 → ×1.4
  assert.ok(Math.abs(last - 600 * 1.4) < 1e-6, `最后一周需求应为 600×1.4，实际 ${last}`);
  assert.ok(
    last >= first * 1.15,
    `最后一周 ${last} 分钟应比第 1 周 ${first} 分钟高 ≥15%`,
  );
});

test('v2 路径（有里程碑）：段预算同样受临近度调制', () => {
  const goal = mkGoal({
    totalHours: 14,
    dueAt: addDaysIso(TERM_START, 14 * 7),
    milestones: [
      { id: 'm1', title: '中期', dueAt: addDaysIso(TERM_START, 7 * 7), cumulativeHours: 7 },
    ],
  });
  // 第 13 周：L=2 → p=0.75 → 增益 1.3；里程碑已过 → 段 = 13..15 周、14 小时 → 段预算 280
  const demand = weeklyDemandMin(goal, 13, TERM_START, PREFS, null, null) as number;
  assert.equal(demand, Math.round(280 * 1.3));
  assert.ok(demand > 280, `临近截止的段需求 ${demand} 应高于均摊段预算 280`);
});

test('向后兼容：无截止 / 无总量 → 需求 null（不参与注水，走旧行为）', () => {
  assert.equal(weeklyDemandMin(mkGoal({}), 1, TERM_START, PREFS, null, null), null);
  assert.equal(weeklyDemandMin(mkGoal({ dueAt: '2026-11-30' }), 1, TERM_START, PREFS, null, null), null);
});
