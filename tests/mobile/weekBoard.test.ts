/**
 * M3（2026-10-07）· WeekBoard 纯逻辑单测
 * ============================================================
 * 覆盖：七天行模型（给定 plan+layer → 计数/今天高亮/日期标签）、切周偏移钳制、
 * 周范围标签。组件层（切周异步重算/展开态）由 E2E 走查兜底。
 *
 * ⚠️ 反向验证：删 weekBoardRows 的 doneIds 过滤 → 完成块被计入「未完成」→ 本文件红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { clampWeekOffset, weekBoardRows, weekRangeLabel } from '@/features/mobile/lib/weekBoard.ts';

const TERM_START = '2026-09-07'; // 周一

const block = (id: string, dow: number, startMin: number) => ({
  id, kind: 'study' as const, dayOfWeek: dow as WeekPlan['blocks'][number]['dayOfWeek'],
  startMin, endMin: startMin + 60, title: `块${id}`,
});

const plan = (blocks: ReturnType<typeof block>[]): WeekPlan => ({
  weekNo: 5, blocks, stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length }, issues: [],
});

const EMPTY_LAYER: UserPlanLayer = {
  schemaVersion: 2, tasks: [], excluded: [], moves: [], slots: [],
  courseOverrides: [], mealPlaces: {}, assignments: [],
};

test('M3 · weekBoardRows：七天计数 = 覆盖层 done 剔除后的未完成件数', () => {
  const p = plan([
    block('w5-d1-a', 1, 480),
    block('w5-d1-b', 1, 600),
    block('w5-d3-c', 3, 900),
  ]);
  const layer: UserPlanLayer = {
    ...EMPTY_LAYER,
    moves: [{ weekNo: 5, blockId: 'w5-d1-b', dayOfWeek: 1, startMin: 600, endMin: 660, source: 'edit', done: true }],
  };
  const rows = weekBoardRows(p, layer, 5, 1, TERM_START);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].dow, 1);
  assert.equal(rows[0].openCount, 1, '周一 2 块完成 1 块 → 剩 1');
  assert.equal(rows[2].openCount, 1, '周三 1 块未完成');
  assert.equal(rows[4].openCount, 0, '周五没有块');
  assert.ok(rows[0].isToday, 'todayDow=1 → 周一高亮');
  assert.ok(!rows[2].isToday);
});

test('M3 · weekBoardRows：日期标签按学期锚点换算（第 5 周 = 10/05–10/11）', () => {
  const rows = weekBoardRows(plan([]), EMPTY_LAYER, 5, 3, TERM_START);
  assert.equal(rows[0].dateLabel, '10/05');
  assert.equal(rows[6].dateLabel, '10/11');
  assert.equal(rows[2].isToday, true, 'todayDow=3');
});

test('M3 · clampWeekOffset：越界停在边界内', () => {
  assert.equal(clampWeekOffset(-1, 1, 20), 0, '第 1 周再往前 = 停在第 1 周');
  assert.equal(clampWeekOffset(1, 20, 20), 0, '最后一周再往后 = 停住');
  assert.equal(clampWeekOffset(1, 5, 20), 1);
  assert.equal(clampWeekOffset(-2, 5, 20), -2);
  assert.equal(clampWeekOffset(99, 5, 20), 15, '远超 → 钳到最后一周');
});

test('M3 · weekRangeLabel：范围标签与跨月', () => {
  assert.equal(weekRangeLabel(TERM_START, 5), '10/05–10/11');
  assert.equal(weekRangeLabel(TERM_START, 1), '9/07–9/13');
  assert.equal(weekRangeLabel('bad-date', 3), '', 'termStart 解析不了 → 空串（不编日期）');
});
