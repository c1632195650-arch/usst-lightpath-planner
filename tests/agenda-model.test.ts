/**
 * UI v2 批次 D1 · 当日流水纯模型断言（agendaModel.ts）
 * ============================================================
 * 纪律（反向验证锚）：
 *   RV-D1-1 ← confirmedOverlaps 改成匹配中文 message → 「机器码背书」用例红
 *   RV-D1-2 ← findDayGaps 把 <10min 碎空也渲染 → 「碎空过滤」用例红
 *   RV-D1-3 ← nowlineProgress 窗口外不返回 null → 「窗口外」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanIssue, TimeBlock } from '@/types';
import {
  agendaBlocksForDay, confirmedOverlaps, findDayGaps, nowlineProgress,
  overlapMinByBlock, overlapPairs, overlapTotalMin,
} from '@/features/week/agendaModel';

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'b1', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60,
    title: '自习', source: 'template',
    ...over,
  };
}

test('D1 分组: agendaBlocksForDay 按天过滤并按开始时间排序', () => {
  const blocks = [
    block({ id: 'late', startMin: 15 * 60 }),
    block({ id: 'early', startMin: 8 * 60 }),
    block({ id: 'other-day', dayOfWeek: 2 }),
  ];
  const day1 = agendaBlocksForDay(blocks, 1);
  assert.deepEqual(day1.map((b) => b.id), ['early', 'late']);
});

test('D1 空档: 相邻块之间识别空洞；<10 分钟碎空不渲染（RV-D1-2）', () => {
  const blocks = [
    block({ id: 'a', startMin: 8 * 60, endMin: 9 * 60 }),
    block({ id: 'b', startMin: 11 * 60 + 30, endMin: 13 * 60 }),
  ];
  const gaps = findDayGaps(blocks, 1);
  // 8:00-22:00 窗口：a 之前无空档（8:00 起）；a→b 之间 9:00-11:30；b→22:00 收尾
  assert.deepEqual(gaps, [
    { startMin: 9 * 60, endMin: 11 * 60 + 30 },
    { startMin: 13 * 60, endMin: 22 * 60 },
  ]);
  const fragmented = findDayGaps([
    block({ id: 'a', startMin: 8 * 60, endMin: 10 * 60 }),
    block({ id: 'b', startMin: 10 * 60 + 5, endMin: 12 * 60 }),
  ], 1);
  assert.equal(fragmented.filter((g) => g.startMin === 10 * 60 && g.endMin === 10 * 60 + 5).length, 0, '5 分钟碎空被过滤');
});

test('D1 冲突: 几何找对 + time-conflict 机器码背书；改匹配文案必红（RV-D1-1）', () => {
  const a = block({ id: 'a', startMin: 9 * 60, endMin: 10 * 60 });
  const b = block({ id: 'b', startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, dayOfWeek: 1 });
  const c = block({ id: 'c', startMin: 14 * 60, endMin: 15 * 60, dayOfWeek: 1 });
  assert.deepEqual(overlapPairs([a, b, c]), [{ aId: 'a', bId: 'b', overlapMin: 30 }], '几何找到 a×b 重叠 30 分钟');

  // 机器码背书：issue.blockId=b（引擎 issueCourseConflict 语义：指向冲突对之一）
  const flagged: PlanIssue[] = [{ level: 'error', code: 'time-conflict', blockId: 'b', message: '随便什么文案——判定不读它' }];
  const confirmed = confirmedOverlaps([a, b, c], flagged);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].overlapMin, 30);

  // 同样的重叠但只有**别的问题码**（无 time-conflict）→ 不算真冲突
  const other: PlanIssue[] = [{ level: 'warn', code: 'transfer-tight', blockId: 'b', message: '转场紧' }];
  assert.equal(confirmedOverlaps([a, b, c], other).length, 0, '非 time-conflict 机器码不背书');

  // 无 issue → 无冲突
  assert.equal(confirmedOverlaps([a, b, c], []).length, 0);
});

test('D1 汇总: 每块重叠分钟映射 + 合计去重', () => {
  const overlaps = [
    { aId: 'a', bId: 'b', overlapMin: 30 },
    { aId: 'b', bId: 'c', overlapMin: 15 },
  ];
  const byBlock = overlapMinByBlock(overlaps);
  assert.equal(byBlock.get('a'), 30);
  assert.equal(byBlock.get('b'), 30, '同块取最大重叠');
  assert.equal(byBlock.get('c'), 15);
  assert.equal(overlapTotalMin(overlaps), 45, '按对求和');
});

test('D1 nowline: 窗口内线性进度；窗口外 null（RV-D1-3）', () => {
  assert.equal(nowlineProgress(8 * 60), 0);
  assert.equal(nowlineProgress(15 * 60), (15 * 60 - 8 * 60) / (14 * 60));
  assert.equal(nowlineProgress(22 * 60), 1);
  assert.equal(nowlineProgress(7 * 60), null, '窗口前不渲染');
  assert.equal(nowlineProgress(23 * 60), null, '窗口后不渲染');
  assert.equal(nowlineProgress(null), null, '未知时间不渲染');
});
