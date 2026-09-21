/**
 * 方法参数编译链测试（tests/method_params.test.ts）
 * ============================================================
 * 断言「方法库 → 编译器 → generated → methods.ts」整条链路的值没有被手改/丢失。
 * 反向验证①：改 scripts/method_kb_data.py 里 pomodoro 的 durations → 重灌库 → 重编译
 * → 本测试必须变红（证明引擎参数真的来自方法库，而不是拍脑袋写死的常量）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDY_DURATIONS,
  POMODORO,
  REVIEW_INTERVALS,
  EXAM_SPRINT,
  SLEEP_GUARD,
  DEEP_WORK,
  methodHint,
} from '@/lib/planner/methods';

test('番茄档位编译自方法库 pomodoro 条目（非手写常量）', () => {
  assert.deepEqual([...STUDY_DURATIONS], [25, 50]);
  assert.equal(POMODORO.focusMin, 25);
  assert.equal(POMODORO.breakMin, 5);
});

test('复习间隔编译自 spaced-repetition-tool 条目', () => {
  assert.deepEqual([...REVIEW_INTERVALS], [1, 3, 7, 15, 30]);
});

test('作息与深度工作红线来自编译产物', () => {
  assert.equal(SLEEP_GUARD.minHours, 7);
  assert.equal(DEEP_WORK.blockMin, 90);
  assert.equal(DEEP_WORK.cycleMin, 90);
});

test('应试冲刺参数来自 exam-strategy 条目', () => {
  assert.equal(EXAM_SPRINT.leadDays, 14);
  assert.equal(EXAM_SPRINT.mockIntervalDays, 3);
  assert.equal(EXAM_SPRINT.minMockCount, 3);
});

test('hints 索引可查且保留证据分级与争议状态', () => {
  const contested = methodHint('growth-mindset');
  assert.ok(contested, 'growth-mindset 应在 hints 中');
  assert.equal(contested!.status, 'contested');
  const verified = methodHint('spacing-effect');
  assert.ok(verified && verified.tier === 'A');
});
