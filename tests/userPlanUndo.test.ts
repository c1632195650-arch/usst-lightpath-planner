/**
 * 撤销栈测试（2026-09-19，用户要求 Ctrl+Z 撤回功能）
 * ============================================================
 * 守的规则：
 *   1. 改动前压栈 → 撤销恢复到改动前的状态（整层快照，不丢字段）
 *   2. 上限 30 步（最旧的被挤出）
 *   3. 栈空时撤销返回 null（调用方不动）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUndo, clearUndo, emptyUserPlan, popUndo, pushUndoSnapshot, undoDepth, SCHEMA_VERSION,
  excludeBlock, upsertMove,
} from '@/features/week/userPlanStore';

test('改动前压栈、撤销即恢复到改动前的整层状态', () => {
  clearUndo();
  const base = emptyUserPlan();
  pushUndoSnapshot(base);
  // 「改动」：删掉一个块
  const after = { ...base, excluded: excludeBlock(base.excluded, 'w3-d2-study-lib-2') };
  assert.equal(canUndo(), true);
  const restored = popUndo();
  assert.deepEqual(restored, base, '整层快照 —— 一个字段都不能少');
  assert.equal(canUndo(), false, '弹完就空了');
});

test('连续多次改动，撤销按后进先出逐层回退', () => {
  clearUndo();
  let layer = emptyUserPlan();
  pushUndoSnapshot(layer);
  layer = { ...layer, excluded: excludeBlock(layer.excluded, 'a') };
  pushUndoSnapshot(layer);
  layer = { ...layer, moves: upsertMove(layer.moves, { weekNo: 3, blockId: 'a', dayOfWeek: 4, startMin: 600, endMin: 660, source: 'drag' }) };
  assert.equal(undoDepth(), 2);
  const step1 = popUndo()!;
  assert.deepEqual(step1.excluded, ['a'], '第一步撤销：回到「已删除、未拖动」');
  const step2 = popUndo()!;
  assert.deepEqual(step2.excluded, [], '第二步撤销：回到什么都没做');
});

test('上限 30 步 —— 最旧的快照被挤出', () => {
  clearUndo();
  for (let i = 0; i < 35; i++) {
    pushUndoSnapshot({ ...emptyUserPlan(), schemaVersion: SCHEMA_VERSION, excluded: [`x${i}`] });
  }
  assert.equal(undoDepth(), 30, '只保留最近 30 步');
  // 最旧的 x0..x4 已被挤出，最早可恢复到 x5
  let last: string[] | null = null;
  for (let i = 0; i < 30; i++) {
    const snap = popUndo()!;
    last = snap.excluded;
  }
  assert.deepEqual(last, ['x5'], '最旧的可恢复状态是第 6 步（x0–x4 被挤出）');
  assert.equal(popUndo(), null);
});
