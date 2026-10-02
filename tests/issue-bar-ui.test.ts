/**
 * 批 6.1 · 议题聚合条 + 列头日期 + 今天高亮（源码锁）
 * ============================================================
 * 设计规范（docs/week-view-design.md）欠账三条：引擎 issue 明细收进顶部聚合条
 * （summarizeIssues 已实现+有单测但未接线）；列头无具体日期；今天列无高亮。
 *
 * ⚠️ 反向验证：删掉聚合条接线 / dayISO 日期渲染 / 今天列高亮条件，对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wpv = readFileSync('src/features/week/WeekPlanView.tsx', 'utf8');

test('聚合条：summarizeIssues 接线 + 顶部 details 条', () => {
  assert.match(wpv, /summarizeIssues/);
  assert.match(wpv, /data-testid="issue-summary-bar"/);
});

test('列头带具体日期（dayISO 换算 + 短日期渲染）', () => {
  assert.match(wpv, /dayISO\(/);
  assert.match(wpv, /dayShort\(/);
});

test('今天列高亮（仅当前周生效）', () => {
  assert.match(wpv, /data-today=\{day === todayDow \? '1' : undefined\}/);
  assert.match(wpv, /day === todayDow \? 'ring-2 ring-brand\/40' : ''/);
});
