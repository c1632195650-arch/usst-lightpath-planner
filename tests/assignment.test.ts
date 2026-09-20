/**
 * T6 测试：作业记录的存储与纯函数
 * ============================================================
 * 覆盖：id 稳定性、时长夹取、覆盖语义、按周筛选、坏数据过滤、localStorage 往返。
 * Node 里没有 localStorage，用内存垫片（`store` 只在函数内访问它）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

class MemStorage {
  _m = new Map();
  get length() { return this._m.size; }
  clear() { this._m.clear(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  key(i) { return [...this._m.keys()][i] ?? null; }
  removeItem(k) { this._m.delete(k); }
  setItem(k, v) { this._m.set(k, String(v)); }
}
globalThis.localStorage = new MemStorage();

import {
  assignmentId, assignmentsOfWeek, clampEstimate, clearAssignments, isAssignment,
  loadAssignments, MAX_ESTIMATE_MIN, MIN_ESTIMATE_MIN, removeAssignment,
  saveAssignments, upsertAssignment, DEFAULT_ESTIMATE_MIN,
} from '@/features/week/assignmentStore';

function item(over = {}) {
  return {
    id: 'as-c-math-w3',
    courseId: 'c-math',
    courseTitle: '高等数学 A',
    weekNo: 3,
    estimatedMin: 60,
    createdAt: '2026-09-19T00:00:00.000Z',
    ...over,
  };
}

test('T6: id 只与「课程 + 周次」有关（同一门课同一周恒等）', () => {
  assert.equal(assignmentId('c-math', 3), 'as-c-math-w3');
  assert.equal(assignmentId('c-math', 3), assignmentId('c-math', 3), '必须稳定');
  assert.notEqual(assignmentId('c-math', 3), assignmentId('c-math', 4), '不同周不同条');
});

test('T6: 时长被夹到合理区间（用户手打 9999 不该占满一天）', () => {
  assert.equal(clampEstimate(9999), MAX_ESTIMATE_MIN);
  assert.equal(clampEstimate(1), MIN_ESTIMATE_MIN);
  assert.equal(clampEstimate(90), 90);
  assert.equal(clampEstimate(NaN), DEFAULT_ESTIMATE_MIN, '拿不到数就用起点值');
});

test('T6: 同 id 覆盖而不是追加（重复标记 = 改时长）', () => {
  const a = upsertAssignment([], item());
  const b = upsertAssignment(a, item({ estimatedMin: 120 }));
  assert.equal(b.length, 1, '同一门课同一周只该有一条');
  assert.equal(b[0].estimatedMin, 120);
});

test('T6: 不同周各自独立', () => {
  const a = upsertAssignment([], item({ weekNo: 3 }));
  const b = upsertAssignment(a, item({ id: 'as-c-math-w4', weekNo: 4 }));
  assert.equal(b.length, 2);
});

test('T6: 按周筛选', () => {
  const items = [item({ weekNo: 3 }), item({ id: 'x', weekNo: 4 })];
  assert.equal(assignmentsOfWeek(items, 3).length, 1);
  assert.equal(assignmentsOfWeek(items, 9).length, 0);
});

test('T6: removeAssignment 只删指定那条', () => {
  const items = [item(), item({ id: 'other' })];
  const next = removeAssignment(items, 'as-c-math-w3');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'other');
});

test('T6: isAssignment 拒绝坏数据（坏数据只该丢自己）', () => {
  assert.equal(isAssignment(item()), true);
  assert.equal(isAssignment(null), false);
  assert.equal(isAssignment({}), false);
  assert.equal(isAssignment(item({ id: '' })), false);
  assert.equal(isAssignment(item({ weekNo: 0 })), false);
  assert.equal(isAssignment(item({ estimatedMin: -5 })), false);
  assert.equal(isAssignment(item({ estimatedMin: '60' })), false);
});

test('T6: save → load 往返一致', () => {
  clearAssignments();
  saveAssignments([item(), item({ id: 'b', weekNo: 5 })]);
  const back = loadAssignments();
  assert.equal(back.length, 2);
  assert.equal(back[0].estimatedMin, 60);
});

test('T6: 版本不符 / 坏 JSON → 回落空（不抛错）', () => {
  localStorage.setItem('usst-assignments-v1', JSON.stringify({ schemaVersion: 999, items: [item()] }));
  assert.deepEqual(loadAssignments(), []);
  localStorage.setItem('usst-assignments-v1', '{ 坏 JSON');
  assert.deepEqual(loadAssignments(), []);
});

test('T6: 坏条目被逐条过滤，好条目保留', () => {
  localStorage.setItem('usst-assignments-v1', JSON.stringify({
    schemaVersion: 1,
    items: [item({ id: 'ok' }), { id: 'bad', weekNo: 0 }],
  }));
  const back = loadAssignments();
  assert.equal(back.length, 1);
  assert.equal(back[0].id, 'ok');
});

test('T6: 未写过 → 空数组', () => {
  clearAssignments();
  assert.deepEqual(loadAssignments(), []);
});
