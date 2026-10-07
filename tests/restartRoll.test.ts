/**
 * 长计划二期 §2.1：最小重启（顺延）
 * ------------------------------------------------------------
 * 验收口径（计划书 + RAY 拍板）：
 *   · 上周 skipped 的目标块 → 本周注入**恰好一个** 25 分钟补课块（防雪崩）；
 *   · 欠账明说（warning 计数）；连续两周欠账 → 降档建议；
 *   · 没标记 ≠ 没做 —— 只有 skipped 进欠账；学期第一周无「上周」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { restartTasks, RESTART_BLOCK_MIN } from '@/features/activity/restartTasks';
import { goalDebtByGoal } from '@/features/behavior/behaviorLog';
import type { BehaviorRecord } from '@/features/behavior/behaviorLog';
import type { Goal } from '@/features/activity/goalStore';

const goals: Goal[] = [
  { id: 'run1', title: '跑步', emoji: '🏃', kind: 'habit' },
  { id: 'math1', title: '高数', emoji: '📐', kind: 'study' },
];

let seq = 0;
function rec(over: Partial<BehaviorRecord>): BehaviorRecord {
  seq += 1;
  return {
    id: over.blockId ? `${over.blockId}@d${seq}` : `x${seq}`,
    blockId: 'b',
    date: '2026-10-05',
    weekNo: 4,
    kind: 'activity',
    title: '块',
    plannedMin: 30,
    status: 'skipped',
    at: '2026-10-05T20:00:00Z',
    ...over,
  };
}

test('上周 skipped 的目标 → 本周恰好一个 25 分钟补课块 + 欠账 warning', () => {
  const records = [
    rec({ blockId: 'goal-run1-w4-d2', weekNo: 4, status: 'skipped', kind: 'activity', title: '跑步 · 主线' }),
    rec({ blockId: 'goal-run1-w4-d5', weekNo: 4, status: 'skipped', kind: 'activity', title: '跑步 · 主线' }),
    rec({ blockId: 'goal-run1-w4-d1', weekNo: 4, status: 'done', kind: 'activity', title: '跑步 · 主线' }),
  ];
  const out = restartTasks(goalDebtByGoal(records, 4), goalDebtByGoal(records, 3), goals, 5);
  const runTasks = out.tasks.filter((t) => t.id.startsWith('goal-run1-restart'));
  assert.equal(runTasks.length, 1, '欠 2 次也只补 1 块（防雪崩）');
  assert.equal(runTasks[0].durationMin, RESTART_BLOCK_MIN);
  assert.ok(runTasks[0].note?.includes('欠账 2 次'));
  assert.equal(out.tasks.filter((t) => t.id.startsWith('goal-math1-')).length, 0, '没欠账的目标不补');
  assert.equal(out.warnings.length, 1);
  assert.ok(out.warnings[0].message.includes('欠账 2 次'));
});

test('连续两周欠账 → 降档建议（而非加压）', () => {
  const records = [
    rec({ blockId: 'goal-run1-w4-d2', weekNo: 4, status: 'skipped', title: '跑步' }),
    rec({ blockId: 'goal-run1-w3-d2', weekNo: 3, status: 'skipped', title: '跑步' }),
  ];
  const out = restartTasks(goalDebtByGoal(records, 4), goalDebtByGoal(records, 3), goals, 5);
  assert.ok(out.warnings[0].message.includes('连续两周欠账'));
  assert.ok(out.warnings[0].message.includes('调低一档'));
});

test('上周做完了 / 没标记 → 不补课不警告', () => {
  const out = restartTasks(
    goalDebtByGoal([
      rec({ blockId: 'goal-run1-w4-d2', weekNo: 4, status: 'done', title: '跑步' }),
    ], 4),
    new Map(),
    goals, 5,
  );
  assert.equal(out.tasks.length, 0);
  assert.equal(out.warnings.length, 0);
});

test('学期第一周（无上周）→ 空输出', () => {
  const out = restartTasks(new Map(), new Map(), goals, 1);
  assert.equal(out.tasks.length, 0);
  assert.equal(out.warnings.length, 0);
});
