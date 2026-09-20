/**
 * 阶段 E 测试：自然语言 → 计划意图
 * ============================================================
 * 四类意图各覆盖正例 + 边界（认不出时必须返回 `unknown`，**绝不瞎猜**）。
 * 纯函数、零依赖、确定性 —— 这正是「不接大模型也能做对话改计划」的前提。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePlanIntent, describeIntent } from '@/features/feedback/planIntent';

/* ============================================================
 * 一、四类意图
 * ========================================================== */

test('intent: 「为什么周三排这么多」→ 解释类（不是要改计划）', () => {
  const r = parsePlanIntent('为什么周三排这么多');
  assert.equal(r.type, 'explain');
});

test('intent: 「删掉周日下午的自习」→ 删除类，且认出星期与类型', () => {
  const r = parsePlanIntent('删掉周日下午的自习');
  assert.equal(r.type, 'remove-block');
  assert.deepEqual(r.days, [7]);
  assert.equal(r.blockKind, 'study');
});

test('intent: 「删掉周三下午的安排」→ 删除类，只说得出星期', () => {
  const r = parsePlanIntent('删掉周三下午的安排');
  assert.equal(r.type, 'remove-block');
  assert.deepEqual(r.days, [3]);
  assert.equal(r.blockKind, undefined, '没说是哪类就不该编一个');
});

test('intent: 「帮我加个周三晚上的实验」→ 添加类，取出标题/星期/时段', () => {
  const r = parsePlanIntent('帮我加个周三晚上的实验');
  assert.equal(r.type, 'add-task');
  assert.ok(r.task.title.includes('实验'), `标题应含「实验」，实际：${r.task.title}`);
  assert.equal(r.task.dayOfWeek, 3);
  assert.equal(r.task.startMin, 18 * 60, '「晚上」应当落成 18:00');
  assert.equal(r.task.kind, 'study');
});

test('intent: 「加一个 90 分钟的实验报告」→ 提取时长', () => {
  const r = parsePlanIntent('加一个 90 分钟的实验报告');
  assert.equal(r.type, 'add-task');
  assert.equal(r.task.durationMin, 90);
});

test('intent: 「周五 15:00 加个组会」→ 提取具体钟点', () => {
  const r = parsePlanIntent('周五15:00加个组会');
  assert.equal(r.type, 'add-task');
  assert.equal(r.task.dayOfWeek, 5);
  assert.equal(r.task.startMin, 15 * 60);
});

test('intent: 「周四下午别排东西」→ 约束类（委托给校正解析器）', () => {
  const r = parsePlanIntent('周四下午别排东西');
  assert.equal(r.type, 'constraint');
  assert.equal(r.draft.kind, 'unavailable_slot');
});

/* ============================================================
 * 二、边界：认不出就不猜
 * ========================================================== */

test('intent: 无关的话 → unknown（不误判成改计划）', () => {
  const r = parsePlanIntent('今天天气不错');
  assert.equal(r.type, 'unknown');
});

test('intent: 空串 / 纯空白 → unknown', () => {
  assert.equal(parsePlanIntent('').type, 'unknown');
  assert.equal(parsePlanIntent('   ').type, 'unknown');
});

test('intent: 「删掉东西」说不出删什么 → unknown（要求补充，而不是乱删）', () => {
  const r = parsePlanIntent('删掉一些东西');
  assert.equal(r.type, 'unknown');
});

test('intent: 永不抛错（各种奇怪输入）', () => {
  const weird = ['!!!', '12345', 'aaaa', '，，，', '🙂', '加'];
  for (const w of weird) {
    assert.doesNotThrow(() => parsePlanIntent(w), `输入「${w}」不该抛错`);
  }
});

/* ============================================================
 * 三、回显（用户确认「引擎理解成什么」）
 * ========================================================== */

test('intent: describeIntent 对四类都给得出人话', () => {
  const add = describeIntent(parsePlanIntent('帮我加个周三晚上的实验'));
  assert.ok(add.includes('实验'), `回显应含标题，实际：${add}`);
  assert.ok(add.includes('周三'), `回显应含星期，实际：${add}`);

  const rm = describeIntent(parsePlanIntent('删掉周日下午的自习'));
  assert.ok(rm.includes('周日'), `回显应含星期，实际：${rm}`);

  const explain = describeIntent({ type: 'explain', topic: '为什么' });
  assert.ok(explain.length > 0);

  const unknown = describeIntent({ type: 'unknown', text: '哈哈' });
  assert.ok(unknown.includes('没看懂'), `认不出要如实说，实际：${unknown}`);
});

test('intent: 不修改传入文本（纯函数纪律）', () => {
  const src = '帮我加个周三晚上的实验';
  const copy = String(src);
  parsePlanIntent(src);
  assert.equal(src, copy);
});
