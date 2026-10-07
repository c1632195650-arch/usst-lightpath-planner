/**
 * 「这一周的情况」问题清单的**同类合并**（纯函数）
 * ============================================================
 * 起因（RAY 2026-10-08）：「这一周的情况那么多信息都是在说什么，能否简化」——
 * 实测现场：同类提示（锁定的块没排进去）一连刷 7 条，每条一整句，把面板淹了。
 * 本文件钉住：合并口径、摘要形态、以及**不把内部 block id 当人话**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIssues, issueRef } from '@/features/week/weekViewUtils';

const lockMsg = (name: string) =>
  `你锁定的「${name}」这次没能排进计划（可能被新课占掉了时间），解开锁定或调整那天的安排都可以`;

test('issueRef：从「…」里取块名；取不到就截断消息', () => {
  assert.equal(issueRef(lockMsg('高数复习')), '高数复习');
  assert.equal(issueRef('一句没有引号的短消息'), '一句没有引号的短消息');
  assert.ok(issueRef('x'.repeat(100)).endsWith('…'));
});

test('同 code ≥2 条 → 合并成一行，摘要带「共 N 处」，明细进 refs', () => {
  const out = groupIssues([
    { level: 'info', code: 'lock-conflict', message: lockMsg('高数复习') },
    { level: 'info', code: 'lock-conflict', message: lockMsg('图书馆自习') },
    { level: 'info', code: 'lock-conflict', message: lockMsg('英语听力') },
  ]);
  assert.equal(out.length, 1, '3 条同类应折成 1 行');
  assert.equal(out[0].grouped, true);
  assert.match(out[0].message, /共 3 处/);
  assert.match(out[0].message, /没能排进计划/, '摘要要说清是哪一类问题');
  assert.deepEqual(out[0].refs, ['高数复习', '图书馆自习', '英语听力'], '明细要能指名道姓');
});

test('单条不合并（保持原样，不为了整齐牺牲可读性）', () => {
  const only = { level: 'warn' as const, code: 'transfer-tight', message: '周三 12:00 转场余 3 分钟' };
  const out = groupIssues([only]);
  assert.equal(out.length, 1);
  assert.equal(out[0].grouped, false);
  assert.equal(out[0].message, only.message);
});

test('不同 code 分开成组，顺序稳定（按首次出现）', () => {
  const out = groupIssues([
    { level: 'info', code: 'lock-conflict', message: lockMsg('A') },
    { level: 'warn', code: 'transfer-tight', message: '紧 A' },
    { level: 'info', code: 'lock-conflict', message: lockMsg('B') },
    { level: 'warn', code: 'transfer-tight', message: '紧 B' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((g) => g.key), ['lock-conflict', 'transfer-tight']);
  assert.deepEqual(out[0].refs, ['A', 'B']);
  assert.equal(out[1].level, 'warn', '级别取自该组第一条');
});

test('没有 code 的消息原样单列（不硬凑合并）', () => {
  const out = groupIssues([
    { level: 'info', message: '第一句' },
    { level: 'info', message: '第二句' },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((g) => g.grouped === false));
});
