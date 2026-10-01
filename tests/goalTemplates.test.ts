/**
 * 目标模板 + 兴趣命中判定测试（总览页改版 批次 5）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GOAL_TEMPLATES, interestAskHit, templateToGoal } from '@/features/activity/goalTemplates';

test('兴趣命中: D01 选「兴奋想报名」即命中', () => {
  assert.equal(interestAskHit({ D01: 'A' }), true);
  assert.equal(interestAskHit({ D01: 'B' }), false);
});

test('兴趣命中: D02/B01 达 4 分即命中，3 分不命中', () => {
  assert.equal(interestAskHit({ D02: 4 }), true);
  assert.equal(interestAskHit({ B01: 5 }), true);
  assert.equal(interestAskHit({ D02: 3, B01: 2 }), false);
  assert.equal(interestAskHit({}), false);
  // D01 命中优先于其它低分
  assert.equal(interestAskHit({ D01: 'A', D02: 1 }), true);
});

test('兴趣命中: 非数值答案安全忽略', () => {
  assert.equal(interestAskHit({ D02: '4', B01: ['x'] }), false);
});

test('模板: 数据完整 —— 每个模板有标题/时长/阶段计划，pace 合法', () => {
  assert.ok(GOAL_TEMPLATES.length >= 4);
  for (const t of GOAL_TEMPLATES) {
    assert.ok(t.title.length > 0, t.id);
    assert.ok(t.suggestedHours > 0, t.id);
    assert.ok(t.planText.length > 0, t.id);
    assert.ok(['steady', 'sprint', 'both'].includes(t.pace), t.id);
    if (t.suggestedDueAt) assert.match(t.suggestedDueAt, /^\d{4}-\d{2}-\d{2}$/, t.id);
  }
});

test('模板: templateToGoal 产出 source:auto 的 Goal，字段覆盖生效', () => {
  const t = GOAL_TEMPLATES[0];
  const g = templateToGoal(
    t,
    { title: '自定义名', dueAt: '2027-01-11', totalHours: 66, pace: 'sprint' },
    'gl-test-1',
  );
  assert.equal(g.id, 'gl-test-1');
  assert.equal(g.title, '自定义名');
  assert.equal(g.source, 'auto');
  assert.equal(g.totalHours, 66);
  assert.equal(g.dueAt, '2027-01-11');
  assert.equal(g.pace, 'sprint');
  assert.equal(g.emoji, t.emoji);
  assert.equal(g.kind, t.kind);
});

test('模板: 空标题回落到模板默认标题；无截止则不带 dueAt 字段', () => {
  const t = GOAL_TEMPLATES[0];
  const g = templateToGoal(t, { title: '', totalHours: 10, pace: 'steady' }, 'gl-test-2');
  assert.equal(g.title, t.title);
  assert.equal('dueAt' in g, false);
});
