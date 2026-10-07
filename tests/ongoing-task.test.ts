/**
 * UI v2 批次 D3 · 焦点卡数据源断言（ongoingTask.ts 纯函数）
 * RV-D3-1 ← ongoingUserTask 改成恒返回第一条任务 → 「时间窗外为 null」用例红
 * RV-D3-2 ← 去掉 durationMin<=0 守卫 → 「零时长」用例红（除零/负进度）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UserTask } from '@/lib/planner/templates';
import { ongoingUserTask } from '@/features/overview/ongoingTask';

const task = (over: Partial<UserTask> = {}): UserTask => ({
  id: 't1', title: '慢跑 3 km', dayOfWeek: 3, startMin: 17 * 60, durationMin: 48,
  ...over,
});

test('D3 进行中: 时间窗内命中，进度/剩余分钟正确', () => {
  const got = ongoingUserTask([task()], 3, 17 * 60 + 30);
  assert.ok(got);
  assert.equal(got.task.title, '慢跑 3 km');
  assert.equal(got.endMin, 17 * 60 + 48);
  assert.equal(got.remainMin, 18);
  assert.ok(Math.abs(got.progress - 30 / 48) < 1e-9);
});

test('D3 焦点纪律: 窗外/别天/零时长/缺开始 → null（无进行中事项不渲染，RV-D3-1/2）', () => {
  assert.equal(ongoingUserTask([task()], 3, 16 * 60), null, '开始前');
  assert.equal(ongoingUserTask([task()], 3, 18 * 60), null, '结束后');
  assert.equal(ongoingUserTask([task()], 4, 17 * 60 + 30), null, '别天');
  assert.equal(ongoingUserTask([task({ durationMin: 0 })], 3, 17 * 60 + 30), null, '零时长（防除零）');
  assert.equal(ongoingUserTask([task({ startMin: undefined })], 3, 17 * 60 + 30), null, '引擎挑空档的未定块');
  assert.equal(ongoingUserTask([], 3, 17 * 60 + 30), null, '空层');
});
