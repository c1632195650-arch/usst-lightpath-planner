/**
 * 「补上来」测试（fillGap：删除后的空档填补）
 * ============================================================
 * 守的规则（用户拍板，不得偏离）：
 *   1. 只挪**软事**（自习/活动/手动块），依次前移、不重叠
 *   2. **课程**与**三餐**纹丝不动；前移撞到它们就跳过其时段
 *   3. **绝不往后推**：前移不了的块保持原位
 *   4. 空档**之前**的块完全不碰
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock } from '@/types';
import { fillGap } from '@/lib/planner/ripple';

const D2 = 2 as TimeBlock['dayOfWeek'];

function blk(over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startMin' | 'endMin'>): TimeBlock {
  return { kind: 'study', dayOfWeek: D2, title: over.id, source: 'template', ...over } as TimeBlock;
}
const course = (id: string, s: number, e: number) =>
  blk({ id, startMin: s, endMin: e, kind: 'course', source: 'course' });
const meal = (id: string, s: number, e: number) =>
  blk({ id, startMin: s, endMin: e, kind: 'meal', source: 'template' });

test('删除后，后面的软事依次前移填补空档（保持顺序、不重叠）', () => {
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }), // 被删：600–660
    blk({ id: 'a', startMin: 660, endMin: 720 }),
    blk({ id: 'b', startMin: 730, endMin: 790 }),
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  const rec = (id: string) => moves.find((m) => m.blockId === id);
  assert.deepEqual([rec('a')!.startMin, rec('a')!.endMin], [600, 660], 'a 补进空档');
  assert.deepEqual([rec('b')!.startMin, rec('b')!.endMin], [660, 720], 'b 跟着往前收');
});

test('三餐是屏障：午饭之后的块（午休）绝不跨过午饭被拉上来', () => {
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }), // 删的是早餐
    meal('lunch', 660, 720),
    blk({ id: 'nap', startMin: 730, endMin: 820 }), // 午休 —— 在午饭后面
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  assert.deepEqual(moves, [], '午饭是屏障：午休不能跨过午饭被拉进早餐时段');
});

test('午饭之前的软事仍可填补，且放置不越过屏障', () => {
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }),
    blk({ id: 'a', startMin: 660, endMin: 700 }), // 40 分钟，午饭前
    meal('lunch', 700, 760),
    blk({ id: 'nap', startMin: 770, endMin: 850 }),
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  const a = moves.find((m) => m.blockId === 'a');
  assert.deepEqual([a!.startMin, a!.endMin], [600, 640], '午饭前的块收进空档');
  assert.ok(!moves.some((m) => m.blockId === 'nap'), '屏障之后的块不参与');
});

test('撞到课程仍可跳过（跨过上午的课收块是合理的），课程不动', () => {
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }),
    course('c1', 660, 720),
    blk({ id: 'a', startMin: 730, endMin: 800 }),
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  // a（70 分钟）被课挡住进不了 60 分钟空档，但能收到课刚结束的位置（720–790）
  const a = moves.find((m) => m.blockId === 'a');
  assert.deepEqual([a!.startMin, a!.endMin], [720, 790]);
  assert.ok(!moves.some((m) => m.blockId === 'c1'), '课程永远不出现在移动记录里');
});

test('大块前移受自身时长限制 —— 收进空档，尾部留白（绝不往后推）', () => {
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }),
    blk({ id: 'big', startMin: 660, endMin: 800 }), // 140 分钟
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  // big 往前收 60 分钟（600–740），这是「往前收」的极限；原尾部 740–800 空出
  assert.deepEqual(moves, [
    { blockId: 'big', dayOfWeek: D2, startMin: 600, endMin: 740 },
  ]);
});

test('空档之前的块完全不碰', () => {
  const blocks = [
    blk({ id: 'before', startMin: 480, endMin: 540 }),
    blk({ id: 'deleted', startMin: 600, endMin: 660 }),
    blk({ id: 'a', startMin: 660, endMin: 700 }),
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  assert.ok(!moves.some((m) => m.blockId === 'before'), '空档前的块不参与');
});

test('跨天隔离：其他天的事不参与这一天的填补', () => {
  const D4 = 4 as TimeBlock['dayOfWeek'];
  const blocks = [
    blk({ id: 'deleted', startMin: 600, endMin: 660 }),
    blk({ id: 'other-day', startMin: 660, endMin: 720, dayOfWeek: D4 }),
  ];
  const moves = fillGap(blocks, D2, 600, 660, 'deleted');
  assert.deepEqual(moves, [], '别的天的块不该被拉过来');
});
