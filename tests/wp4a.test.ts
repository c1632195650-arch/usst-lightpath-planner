/**
 * WP4a —— 引擎 ripple 语义修复（B1 收敛扫描 / B4 三餐升格为不动针）
 * ============================================================
 * B1：makeRoom 的顺延跳课原是**单遍扫描**——课程数组未排序时，
 *     跳过 K1 可能落进 K2 的时段（K2 在数组里排在前面、已检查过）。
 *     修法：对齐 fillGap 的 while(changed) 收敛写法。
 * B4：makeRoom 的 movable 原本只排除课程 —— 三餐可以被顺延，
 *     与 fillGap 的「三餐屏障」语义矛盾。统一为 isRippleBarrier（model.ts）。
 *
 * ⚠️ 反向验证纪律（记录见 docs/wp-ledger-v2.md §WP4a）：
 *   RV-B1 ← 跳课循环还原成单遍 → 「B1 收敛」用例红
 *   RV-B4 ← movable 还原成只排课程 → 「B4 三餐不动」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, dragTo, fillGap } from '@/lib/planner/ripple';
import type { TimeBlock } from '@/types';

const blk = (id: string, kind: TimeBlock['kind'], start: number, end: number, source: TimeBlock['source'] = 'template'): TimeBlock =>
  ({ id, kind, dayOfWeek: 2, startMin: start, endMin: end, title: id, source } as TimeBlock);

/* ---------------- B1：跳课收敛（未排序课程数组） ---------------- */

test('B1 收敛: 课程数组未排序时，顺延跳过 K1 不得落进 K2（单遍扫描的漏检场景）', () => {
  // 反向：跳课循环还原成单遍（去掉 while(changed)）→ 本用例红
  // 课程在数组里**倒序**排列（K2 在前、K1 在后）—— 单遍扫描按数组序检查：
  // K2(700-790) 不撞 → K1(600-690) 撞 → start=690 → [690-730] 与 K2 重叠！
  const blocks = [
    blk('K2', 'course', 700, 790, 'course'),
    blk('K1', 'course', 600, 690, 'course'),
    blk('M', 'study', 560, 600),
  ];
  const target = blk('T', 'activity', 560, 600);
  const r = makeRoom(blocks, target, { dayStartMin: 480, dayEndMin: 1320 });
  assert.equal(r.blockedByCourse, false);
  assert.equal(r.dropped.length, 0);
  // 顺延结果不得与任何课程重叠（B1 的立身之本）
  for (const b of r.blocks) {
    if (b.kind !== 'course') continue;
    for (const m of r.moved) {
      const movedBlock = r.blocks.find((x) => x.id === m.id)!;
      const noOverlap = movedBlock.endMin <= b.startMin || movedBlock.startMin >= b.endMin;
      assert.ok(noOverlap, `顺延块 ${m.id} [${movedBlock.startMin}-${movedBlock.endMin}] 撞上了课程 ${b.id} [${b.startMin}-${b.endMin}]`);
    }
  }
});

/* ---------------- B4：三餐是不动针 ---------------- */

test('B4: 顺延不得挪动三餐 —— 饭点钉在原地，软块跳到它后面', () => {
  // 反向：movable 还原成只排课程（三餐可被顺延）→ 本用例红
  const blocks = [
    blk('A', 'activity', 640, 700),   // 被目标压住的软块
    blk('L', 'meal', 700, 750),       // 午餐
  ];
  const target = blk('T', 'study', 660, 700);
  const r = makeRoom(blocks, target, { dayStartMin: 480, dayEndMin: 1320 });
  assert.equal(r.blockedByMeal, undefined, '目标不直接压饭点 → 不该报 blockedByMeal');
  const meal = r.blocks.find((b) => b.id === 'L')!;
  assert.equal(meal.startMin, 700, '三餐纹丝不动（旧实现会把午餐顺延）');
  assert.ok(!r.moved.some((m) => m.id === 'L'), '三餐不得出现在顺延清单里');
  assert.equal(r.blocks.filter((b) => b.id === 'L').length, 1, '块不得重复（H1 硬约束；旧 movable 口径会产出双份午餐）');
  const movedA = r.moved.find((m) => m.id === 'A');
  assert.ok(movedA && movedA.toStartMin >= 750, '软块 A 必须跳到午餐后面（≥750）');
});

test('B4: 目标直接压在饭点上 → blockedByMeal（dragTo 给人话理由）', () => {
  const blocks = [blk('L', 'meal', 700, 750)];
  const r = makeRoom(blocks, blk('T', 'study', 710, 760), { dayStartMin: 480, dayEndMin: 1320 });
  assert.equal(r.blockedByMeal, true);
  assert.equal(r.moved.length, 0, '一个块都不动');

  const d = dragTo(
    [blk('L', 'meal', 700, 750), blk('S', 'study', 480, 540)],
    'S', 2, 710, { dayStartMin: 480, dayEndMin: 1320 },
  );
  assert.equal(d.ok, false);
  assert.match(d.reason ?? '', /吃饭|饭点/);
});

test('B4 回归: fillGap 的三餐屏障语义不变（同一谓词的两面）', () => {
  // 屏障前的块前移不越过屏障；makeRoom 现在与它共用 isRippleBarrier
  const blocks = [
    blk('L', 'meal', 700, 750),
    blk('B', 'study', 760, 820),   // 屏障后 → 不参与
    blk('A', 'study', 620, 660),   // 屏障前 → 参与前移
  ];
  const moves = fillGap(blocks, 2, 600, 700);
  assert.ok(moves.every((m) => m.endMin <= 700), '前移不得越过午餐起点 700');
});
