/**
 * 长目标优先级模块 · 纯函数（拖拽排序 → 档位映射 → 默认排序）
 * ------------------------------------------------------------
 * 验收口径（RAY 拍板「拖拽排序，左高右低」）：
 *   · 左起第 0 位 = 5 档（最高），依次递减，第 4 位起 = 1（>5 个目标后半并列）；
 *   · 默认顺序 = 临近度 desc → 现有 priority desc → id 稳定序；
 *   · prioritiesFromOrder 把整条顺序映射成补丁（供一次落库）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderGoalsByPriority, prioritiesFromOrder, priorityForIndex } from '@/features/activity/priorityOrder';
import type { Goal } from '@/features/activity/goalStore';

const TERM = '2026-08-31';

function mk(id: string, over: Partial<Goal>): Goal {
  return { id, title: id, emoji: '🎯', kind: 'study', ...over };
}

test('priorityForIndex：第 0 位 = 5，依次递减，第 4 位起 = 1', () => {
  assert.equal(priorityForIndex(0), 5);
  assert.equal(priorityForIndex(1), 4);
  assert.equal(priorityForIndex(2), 3);
  assert.equal(priorityForIndex(3), 2);
  assert.equal(priorityForIndex(4), 1);
  assert.equal(priorityForIndex(6), 1);
});

test('orderGoalsByPriority：临近度 desc 优先，同临近度看 priority desc，再 id 稳定', () => {
  // g-urgent：第 2 周截止（临近度高）；g-high 与 g-low 临近度相同，priority 分胜负
  const goals = [
    mk('g-low', { dueAt: '2026-11-23', priority: 2 }),
    mk('g-mid', { dueAt: '2026-10-14' }),
    mk('g-high', { dueAt: '2026-11-23', priority: 4 }),
  ];
  const order = orderGoalsByPriority(goals, 6, TERM).map((g) => g.id);
  assert.deepEqual(order, ['g-mid', 'g-high', 'g-low']);
});

test('prioritiesFromOrder：整条顺序 → 各目标档位补丁', () => {
  const patches = prioritiesFromOrder(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(
    patches.map((p) => p.priority),
    [5, 4, 3, 2, 1, 1],
  );
});
