/**
 * 一键还原测试（2026-10-07，CY 提的第六缺口：调整后一键回到最初状态）
 * ============================================================
 * 守的规则：
 *   1. restoreEngineWeek 清掉本周的三类干预（moves / excluded / 一次性 tasks），
 *      保留事实声明（长期任务 / 不可时段 / 调课停课 / 作业时长）与其他周数据
 *   2. engineRestoreCount 与 restoreEngineWeek 同口径（按钮启用判定不虚报）
 *   3. withoutWeekLocks 清本周块锁两半、保留长期锁（odd-/even-）与其他周锁
 *   4. 还原走撤销栈可整体回退（restoreEngineWeek 前后压栈往返）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyUserPlan, restoreEngineWeek, engineRestoreCount, upsertMove, excludeBlock,
  clearUndo, pushUndoSnapshot, popUndo,
  type UserPlanLayer,
} from '@/features/week/userPlanStore';
import { emptyPlanState, withLock, withLongLock, withoutWeekLocks, weekLockCount } from '@/features/plan/planLock';
import type { TimeBlock } from '@/types';

function week3Layer(): UserPlanLayer {
  return {
    ...emptyUserPlan(),
    moves: upsertMove(
      upsertMove([], { weekNo: 3, blockId: 'w3-d2-study-a', dayOfWeek: 4, startMin: 600, endMin: 660, source: 'drag' }),
      { weekNo: 4, blockId: 'w4-d1-study-b', dayOfWeek: 1, startMin: 600, endMin: 660, source: 'drag' },
    ),
    excluded: excludeBlock(excludeBlock([], 'w3-d3-study-c'), 'w11-d1-study-d'),
    tasks: [
      { id: 't-once', title: '留白', weeks: [3] },
      { id: 't-long', title: '每周例会记录', weeks: [] },
    ],
    slots: [{ id: 's1', days: [3], fromMin: 780, toMin: 900, weeks: [3], scope: 'once', createdAtWeek: 3 }],
    courseOverrides: [{ id: 'o1', courseId: 'c1', startPeriod: 1, weekNo: 3, action: 'cancel' }],
    assignments: [{ id: 'a1', courseId: 'c-math', minutes: 90 }],
  };
}

test('还原清本周干预：moves/excluded/一次性 tasks 全清，第 4 周与第 11 周数据不动', () => {
  const next = restoreEngineWeek(week3Layer(), 3);
  assert.equal(next.moves.some((m) => m.weekNo === 3), false, '本周 moves 清空');
  assert.equal(next.moves.some((m) => m.weekNo === 4), true, '其他周 moves 保留');
  assert.equal(next.excluded.includes('w3-d3-study-c'), false, '本周 excluded 清空');
  assert.equal(next.excluded.includes('w11-d1-study-d'), true, '其他周 excluded 保留');
  assert.equal(next.tasks.some((t) => t.id === 't-once'), false, '本周一次性任务清空');
  assert.equal(next.tasks.some((t) => t.id === 't-long'), true, '长期任务保留');
});

test('还原保留事实声明：不可时段 / 调课停课 / 作业时长 / schemaVersion', () => {
  const base = week3Layer();
  const next = restoreEngineWeek(base, 3);
  assert.equal(next.slots.length, 1, '不可时段保留（事实声明，非排布干预）');
  assert.equal(next.courseOverrides.length, 1, '调课停课保留');
  assert.equal(next.assignments.length, 1, '作业时长保留（用户录入的数据）');
  assert.equal(next.schemaVersion, base.schemaVersion);
});

test('engineRestoreCount 与还原函数同口径', () => {
  const base = week3Layer();
  assert.equal(engineRestoreCount(base, 3), 3, '本周 1 move + 1 excluded + 1 task');
  assert.equal(engineRestoreCount(base, 4), 1, '第 4 周只有 1 条 move');
  assert.equal(engineRestoreCount(restoreEngineWeek(base, 3), 3), 0, '还原后归零');
});

test('withoutWeekLocks 清本周块锁两半，长期锁与滚动状态原样保留', () => {
  const block: TimeBlock = { id: 'w3-d3-act-x', kind: 'activity', dayOfWeek: 3, startMin: 840, endMin: 900, title: '例会', source: 'template' } as TimeBlock;
  const longBlock: TimeBlock = { ...block, id: 'w3-d3-act-y' } as TimeBlock;
  let ps = emptyPlanState();
  ps = withLock(ps, block);
  ps = withLongLock(ps, 3, longBlock, '');
  ps = { ...ps, rolling: { recentLoad: [1, 2] } } as typeof ps;
  assert.equal(weekLockCount(ps, 3), 1, '本周 1 把块锁');
  const next = withoutWeekLocks(ps, 3);
  assert.equal(Object.keys(next.locks).length, 1, '只剩长期锁一把');
  assert.ok(Object.keys(next.locks)[0].startsWith('odd-') || Object.keys(next.locks)[0].startsWith('even-'), '剩下的是长期锁 key');
  assert.deepEqual(next.rolling, ps.rolling, '滚动状态不动');
  assert.equal(weekLockCount(withoutWeekLocks(emptyPlanState(), 1), 1), 0, '空状态还原不出错');
  // w1- 前缀不得误匹配 w11-（前缀带短横线）
  const ps11 = withLock(emptyPlanState(), { ...block, id: 'w11-d1-study-z' } as TimeBlock);
  assert.equal(weekLockCount(withoutWeekLocks(ps11, 1), 11), 1, '清第 1 周不会误伤第 11 周的锁');
});

test('还原走撤销栈可整体回退（压栈 → 还原 → 弹栈恢复）', () => {
  clearUndo();
  const before = week3Layer();
  pushUndoSnapshot(before);
  const after = restoreEngineWeek(before, 3);
  assert.notDeepEqual(after.excluded, before.excluded);
  const restored = popUndo();
  assert.deepEqual(restored, before, '一次 Ctrl+Z 整体回到还原前（含被清的 excluded/moves/tasks）');
});
