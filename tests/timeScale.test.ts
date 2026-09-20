/**
 * 空闲空档 + 拖拽吸附测试
 * ============================================================
 * （双层时间视图已于 2026-09-19 回退，本文件只保留仍存在的功能：
 *   概览态空闲块（≥30 分钟）与整块拖拽的 10 分钟吸附。）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock } from '@/types';
import { freeGapsOf, snap10 } from '@/features/week/timeScale';

const D2 = 2 as TimeBlock['dayOfWeek'];

function blk(over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startMin' | 'endMin'>): TimeBlock {
  return { kind: 'study', dayOfWeek: D2, title: over.id, source: 'template', ...over } as TimeBlock;
}

test('吸附：10 分钟档（整块拖拽粒度）', () => {
  assert.equal(snap10(602), 600);
  assert.equal(snap10(607), 610);
});

test('空闲空档：≥30 分钟才显示；被安排切开的时段各自成块', () => {
  const blocks = [
    blk({ id: 'a', startMin: 480, endMin: 540 }),   // 8:00–9:00
    blk({ id: 'b', startMin: 570, endMin: 630 }),   // 9:30–10:30
  ];
  const gaps = freeGapsOf(blocks, D2);
  assert.deepEqual(
    gaps.map((g) => [g.startMin, g.endMin]),
    [[420, 480], [540, 570], [630, 1380]],
    '7:00–8:00、9:00–9:30（恰 30 分钟）、10:30–23:00 三段都要显示',
  );
});

test('空闲空档：小于 30 分钟的碎片不显示；只算指定那天', () => {
  const blocks = [
    blk({ id: 'a', startMin: 480, endMin: 540 }),
    blk({ id: 'frag', startMin: 550, endMin: 570 }), // 10 分钟碎片
    blk({ id: 'other', startMin: 600, endMin: 660, dayOfWeek: 4 as TimeBlock['dayOfWeek'] }),
  ];
  const gaps = freeGapsOf(blocks, D2);
  assert.deepEqual(
    gaps.map((g) => [g.startMin, g.endMin]),
    [[420, 480], [570, 1380]],
    '540–550 只有 10 分钟碎片不显示（被碎块与前一课夹住）；其他天的块不参与',
  );
});
