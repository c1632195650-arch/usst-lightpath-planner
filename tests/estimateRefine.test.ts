/**
 * 长计划二期 §2.2：执行回流估时
 * ------------------------------------------------------------
 * 验收口径（计划书）：
 *   · 样本 < 2 → 不修正；中位数偏差 ≤15% → 不修正；
 *   · 修正 = base × 中位数/基准，钳制 ±20%；
 *   · 标题匹配到任务 → 估时被替换；样本池取「近 4 次 done 且补记了 actualMin」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refinedDurationMin } from '@/lib/planner/corrections';
import { refineTaskDurations } from '@/features/behavior/refine';
import { durationSamplesByTitle } from '@/features/behavior/behaviorLog';
import type { BehaviorRecord } from '@/features/behavior/behaviorLog';
import type { UserTask } from '@/lib/planner/templates';

let seq = 0;
function doneRec(title: string, actualMin: number, weekNo = 8): BehaviorRecord {
  seq += 1;
  return {
    id: `blk-${seq}@d${seq}`,
    blockId: `blk-${seq}`,
    date: '2026-10-05',
    weekNo,
    kind: 'study',
    title,
    plannedMin: 45,
    status: 'done',
    actualMin,
    at: '2026-10-05T20:00:00Z',
  };
}

test('refinedDurationMin：<2 样本 / 偏差 ≤15% → null（不动基准）', () => {
  assert.equal(refinedDurationMin(45, [60]), null);
  assert.equal(refinedDurationMin(45, [46, 47]), null);
  assert.equal(refinedDurationMin(45, []), null);
  assert.equal(refinedDurationMin(0, [60, 60]), null);
});

test('refinedDurationMin：中位数修正 + ±20% 钳制', () => {
  // 计划 45、实际 58/60/57/59 → 中位数 58.5 → 偏差 30% → 修正 45×1.2=54（钳制）
  assert.equal(refinedDurationMin(45, [58, 60, 57, 59]), 54);
  // 偏差 20%~：计划 45、中位数 54 → 54/45=1.2 → 45×1.2=54
  assert.equal(refinedDurationMin(45, [54, 54]), 54);
  // 反向：计划 90、实际 63/65 → 中位 64 → 比例 0.711 → 钳 0.8 → 72
  assert.equal(refinedDurationMin(90, [63, 65]), 72);
});

test('durationSamplesByTitle：只取该标题、done 且有 actualMin、近 4 条', () => {
  const records = [
    doneRec('跑步 · 主线', 60, 8),
    doneRec('跑步 · 主线', 58, 7),
    { ...doneRec('跑步 · 主线', 70, 7), status: 'skipped' as const },
    doneRec('别的目标 · 主线', 99, 8),
    doneRec('跑步 · 主线', 55, 6),
    doneRec('跑步 · 主线', 52, 5),
    doneRec('跑步 · 主线', 49, 4), // 超出 4 周窗口（weeksBack=4，最新周=8 → 窗口 5..8）
  ];
  const samples = durationSamplesByTitle(records, '跑步 · 主线');
  assert.deepEqual(samples.sort((a, b) => b - a), [60, 58, 55, 52]);
});

test('refineTaskDurations：标题命中的任务换估时，未命中原样', () => {
  const records = [doneRec('跑步 · 主线', 60), doneRec('跑步 · 主线', 58)];
  const tasks: UserTask[] = [
    { id: 't1', title: '跑步 · 主线', durationMin: 45, kind: 'activity', category: 'custom' },
    { id: 't2', title: '没历史 · 主线', durationMin: 45, kind: 'study', category: 'custom' },
    { id: 't3', title: '跑步 · 打底' }, // 无 durationMin → 不动
  ];
  const out = refineTaskDurations(tasks, records);
  assert.equal(out[0].durationMin, 54); // 45×1.2（钳制）
  assert.equal(out[1].durationMin, 45);
  assert.equal(out[2].durationMin, undefined);
});
