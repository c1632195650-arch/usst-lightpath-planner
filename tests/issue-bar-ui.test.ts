/**
 * 批 6.1 · 议题聚合条 + 列头日期 + 今天高亮（源码锁）
 * ============================================================
 * 设计规范（docs/week-view-design.md）欠账三条：引擎 issue 明细收进顶部聚合条
 * （summarizeIssues 已实现+有单测但未接线）；列头无具体日期；今天列无高亮。
 *
 * ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：聚合条 = \`WeekDiagnostics.WeekIssuesPanel\`；
 *    列头/今天列 = \`WeekTimelineGrid\` —— 列头已带 \`mm/dd\` 与「今天」徽章、
 *    今天列底色 \`TODAY_COL_BG\`、滚动锚 \`data-today-col\` 挂在列头。语义不变。
 * ⚠️ 反向验证：删掉聚合条接线 / 列头日期渲染 / 今天列判定，对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const diag = readFileSync('src/features/week/WeekDiagnostics.tsx', 'utf8');
const grid = readFileSync('src/features/week/WeekTimelineGrid.tsx', 'utf8');

test('聚合条：summarizeIssues 接线 + 顶部 details 条', () => {
  assert.match(diag, /summarizeIssues/);
  assert.match(diag, /data-testid="issue-summary-bar"/);
});

test('列头带具体日期（dateISO 换算 + 短日期渲染）', () => {
  assert.match(grid, /dateISO\.slice\(5\)\.split\('-'\)\.map\(Number\)/);
  assert.match(grid, /\{mm\}\/\{dd\}/);
});

test('今天列高亮（仅当前周生效；todayDow 非本周恒 null）', () => {
  assert.match(grid, /const isToday = todayDow === day;/);
  assert.match(grid, /style=\{isToday \? \{ backgroundColor: TODAY_COL_BG \} : undefined\}/);
  assert.match(grid, /data-today-col=\{isToday \? '' : undefined\}/);
});
