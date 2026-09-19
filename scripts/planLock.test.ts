/**
 * 锁的两半状态读写（`features/plan/planLock.ts`）
 * 跑法：npm run test:ui
 *
 * 这组测试盯的是**一种很容易写歪的错误**：锁有「级别」和「位置快照」两半，
 * 只写一半不会报错，但会让功能静默失效 ——
 *   · 只写级别 → 界面显示「已定住」，块照样跑（因为没人把它写回原位）；
 *   · 只写快照 → 块被钉住，但用户从没锁过它。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyPlanState, isLocked, lockCount, lockedPlacementsOf, lockLevelsOf,
  normalizePlanState, withLock, withoutLock,
} from '@/features/plan/planLock.ts';
import type { TimeBlock } from '@/types';

const block: TimeBlock = {
  id: 'w4-d1-study-study-lib-1',
  kind: 'study',
  dayOfWeek: 1,
  startMin: 775,
  endMin: 835,
  title: '图书馆自习',
  emoji: '📚',
  place: '图书馆（图文信息中心）',
  source: 'template',
};

test('上锁会同时写下「级别」和「位置快照」两半', () => {
  const s = withLock(null, block, 'hard', '2026-09-16T00:00:00.000Z');
  assert.equal(s.locks[block.id], 'hard');
  assert.deepEqual(s.lockedPlacements[block.id], {
    dayOfWeek: 1, startMin: 775, endMin: 835,
    place: '图书馆（图文信息中心）', room: undefined, title: '图书馆自习',
  });
  assert.equal(s.updatedAt, '2026-09-16T00:00:00.000Z');
});

test('解锁会把两半一起删掉（不留脏快照）', () => {
  const locked = withLock(null, block);
  const unlocked = withoutLock(locked, block.id);
  assert.equal(unlocked.locks[block.id], undefined);
  assert.equal(unlocked.lockedPlacements[block.id], undefined);
  assert.equal(isLocked(unlocked, block.id), false);
  assert.equal(lockCount(unlocked), 0);
});

test('解锁不碰其他块', () => {
  const other: TimeBlock = { ...block, id: 'w4-d3-study-study-lib-1', dayOfWeek: 3 };
  let s = withLock(null, block);
  s = withLock(s, other);
  s = withoutLock(s, block.id);
  assert.equal(lockCount(s), 1);
  assert.equal(isLocked(s, other.id), true);
});

test('从存储读出来的半截状态会被兜住（缺 keys 不炸）', () => {
  // 模拟「v4 老数据」：planState 存在、但没有 lockedPlacements
  const legacy = { version: 1, lastPlanWeek: 4, locks: {}, churnMin: 0, updatedAt: '', rolling: null } as never;
  const fixed = normalizePlanState(legacy);
  assert.ok(fixed);
  assert.deepEqual(fixed.lockedPlacements, {});
  assert.deepEqual(lockLevelsOf(legacy), {});
  assert.deepEqual(lockedPlacementsOf(legacy), {});
});

test('null / undefined 一律安全返回空表（不能抛）', () => {
  assert.equal(normalizePlanState(null), null);
  assert.deepEqual(lockLevelsOf(null), {});
  assert.deepEqual(lockedPlacementsOf(undefined), {});
  assert.equal(lockCount(null), 0);
  assert.equal(isLocked(null, block.id), false);
});

test('emptyPlanState 的形状与契约一致', () => {
  const s = emptyPlanState();
  assert.equal(s.version, 1);
  assert.equal(s.lastPlanWeek, null);
  assert.deepEqual(s.locks, {});
  assert.deepEqual(s.lockedPlacements, {});
  assert.equal(s.rolling, null);
});
