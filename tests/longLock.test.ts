/**
 * S1 测试：长期锁（定住跨周，单双周分开）+ 顺延（ripple）
 * ============================================================
 * 守的四件事：
 *   1. **跨周生效**：第 3 周点的定住，第 5 / 7 周自动留出（同一奇偶）
 *   2. **单双周分开**：偶数周的锁不影响奇数周（用户明确要求）
 *   3. **撞课 = 本周跳过 + 只留 info**（不报 warn；硬约束 H1 不放宽）
 *   4. **软块顺延**：被占了会让路，而不是被吞掉 or 重叠
 *
 * ⚠️ 第 2 行开始的连续注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock, WeekPlan } from '@/types';
import {
  applyLongLocks, isLongLockKey, longLockKey, longLockTargetsFor, weekParity,
} from '@/lib/planner/longLocks';
import { canMakeRoom, makeRoom } from '@/lib/planner/ripple';

const D2 = 2 as TimeBlock['dayOfWeek'];
const D3 = 3 as TimeBlock['dayOfWeek'];

function blk(over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startMin' | 'endMin'>): TimeBlock {
  return {
    kind: 'study', dayOfWeek: D2, title: over.title ?? over.id, source: 'template',
    ...over,
  } as TimeBlock;
}

function course(id: string, startMin: number, endMin: number, dayOfWeek = D2): TimeBlock {
  return blk({ id, startMin, endMin, kind: 'course', source: 'course', dayOfWeek, title: '高等数学' });
}

function weekPlan(blocks: TimeBlock[], weekNo = 5): WeekPlan {
  return {
    weekNo,
    blocks,
    issues: [],
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
  };
}

const bounds = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 };

/* ------------------------------------------------------------
 * 一、key 形状
 * ---------------------------------------------------------- */

test('长期锁 key 不含周次与序号 —— 这是它能跨周的前提', () => {
  const a = blk({ id: 'w3-d2-study-lib-2', startMin: 900, endMin: 1020 });
  const key3 = longLockKey(3, a);
  const key5 = longLockKey(5, a);
  assert.equal(key3, key5, '同一奇偶周的同一时段必须得到同一个 key');
  assert.equal(key3, 'odd-d2-study-900-1020');
  assert.ok(isLongLockKey(key3));

  const even = longLockKey(4, a);
  assert.equal(even, 'even-d2-study-900-1020');
  assert.notEqual(key3, even, '单周锁与双周锁必须是两个不同的 key');
  assert.equal(weekParity(7), 'odd');
  assert.equal(weekParity(8), 'even');
});

/* ------------------------------------------------------------
 * 二、顺延（ripple）
 * ---------------------------------------------------------- */

test('目标时段空着 → 直接插入，别的块一个都不动', () => {
  const existing = [blk({ id: 'a', startMin: 480, endMin: 540 })];
  const target = blk({ id: 'T', startMin: 600, endMin: 660, kind: 'study' });
  const r = makeRoom(existing, target, bounds);
  assert.equal(r.moved.length, 0, '没人挡路时不该动任何块');
  assert.equal(r.dropped.length, 0);
  assert.equal(r.blocks.filter((b) => b.id === 'T').length, 1);
});

test('挡路的软块往后顺延，且**不重叠**', () => {
  const existing = [blk({ id: 'a', startMin: 600, endMin: 660 }), blk({ id: 'b', startMin: 670, endMin: 700 })];
  const target = blk({ id: 'T', startMin: 600, endMin: 660, kind: 'study' });
  const r = makeRoom(existing, target, bounds);
  assert.equal(r.blockedByCourse, false);
  const a = r.blocks.find((b) => b.id === 'a');
  const b = r.blocks.find((b) => b.id === 'b');
  assert.ok(a && b, '两个块都还在 —— 顺延不是删除');
  assert.equal(a.startMin, 660, '被挡的块排到目标结束之后');
  assert.ok(b.startMin >= a.endMin, '后面的块跟着往后，不产生重叠');
  assert.equal(canMakeRoom(existing, target, bounds), true);
});

test('顺延遇到课程 → 跳过课程之后接着排（课程永不动）', () => {
  const existing = [
    blk({ id: 's', startMin: 660, endMin: 720 }),
    course('c1', 780, 840),
  ];
  const target = blk({ id: 'T', startMin: 660, endMin: 720, kind: 'study' });
  const r = makeRoom(existing, target, bounds);
  const c = r.blocks.find((b) => b.id === 'c1');
  const s = r.blocks.find((b) => b.id === 's');
  assert.deepEqual([c?.startMin, c?.endMin], [780, 840], '课程必须纹丝不动');
  assert.ok(s && (s.startMin >= 840 || s.endMin <= 780), '被顺延的块不能压在课上');
});

test('目标时段被课程占着 → 一个块都不动，如实报 blockedByCourse', () => {
  const existing = [course('c1', 600, 700)];
  const target = blk({ id: 'T', startMin: 620, endMin: 680, kind: 'study' });
  const r = makeRoom(existing, target, bounds);
  assert.equal(r.blockedByCourse, true);
  assert.equal(r.blocks.length, 1, '没有偷偷插入，也没有删课');
  assert.equal(canMakeRoom(existing, target, bounds), false);
});

test('塞不下 → 报 dropped，绝不制造重叠（硬约束 H1 不能破）', () => {
  const existing = [blk({ id: 'big', startMin: 1380, endMin: 1439 })]; // 23:00 前塞满
  const target = blk({ id: 'T', startMin: 1370, endMin: 1400, kind: 'study' });
  const r = makeRoom(existing, target, bounds);
  assert.ok(r.dropped.length > 0, '放不下必须说出来');
  const day = r.blocks.filter((b) => b.dayOfWeek === D2).sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < day.length; i++) {
    assert.ok(day[i].startMin >= day[i - 1].endMin, '同一天不得出现重叠');
  }
});

/* ------------------------------------------------------------
 * 三、长期锁的应用：跨周 / 单双周 / 撞课
 * ---------------------------------------------------------- */

const placements = {
  'odd-d2-study-900-1020': {
    dayOfWeek: D2, startMin: 900, endMin: 1020, title: '自习（周二上午）',
  },
};
const levels = { 'odd-d2-study-900-1020': 'hard' } as Record<string, 'hard'>;

test('第 3 周点的定住 → 第 5、7 周按时留出（同奇偶）', () => {
  for (const weekNo of [5, 7]) {
    const r = applyLongLocks(weekPlan([], weekNo), placements, levels, weekNo, bounds);
    assert.deepEqual(r.reserved, ['odd-d2-study-900-1020']);
    const got = r.blocks.find((b) => b.id === 'odd-d2-study-900-1020');
    assert.ok(got, `第 ${weekNo} 周必须留出这个时段`);
    assert.deepEqual([got.dayOfWeek, got.startMin, got.endMin], [2, 900, 1020]);
    assert.equal(got.locked, true, '留出的块必须是 hard —— 否则 improve 会把它挪走');
  }
});

test('第 4、6 周（偶数周）不受单周锁影响', () => {
  for (const weekNo of [4, 6]) {
    const r = applyLongLocks(weekPlan([], weekNo), placements, levels, weekNo, bounds);
    assert.deepEqual(r.reserved, [], `第 ${weekNo} 周不该出现单周的锁`);
    assert.equal(r.blocks.length, 0);
  }
});

test('目标列表按奇偶筛选 —— 双周锁只在双周出现', () => {
  const evenKey = 'even-d3-study-900-1020';
  const p = { [evenKey]: { dayOfWeek: D3, startMin: 900, endMin: 1020, title: 'T' } };
  const lv = { [evenKey]: 'hard' } as Record<string, 'hard'>;
  assert.equal(longLockTargetsFor(p, lv, 3).length, 0);
  assert.equal(longLockTargetsFor(p, lv, 4).length, 1);
});

test('撞课 → 本周跳过 + 只留 info（不报 warn、不排到别处）', () => {
  const blocks = [course('c1', 900, 1000)];
  const plan = weekPlan(blocks, 5);
  const r = applyLongLocks(plan, placements, levels, 5, bounds);
  assert.deepEqual(r.reserved, [], '撞课本周就不排');
  assert.equal(r.skipped.length, 1);
  const info = plan.issues.filter((i) => i.level === 'info');
  assert.equal(info.length, 1, '只留一条 info');
  assert.equal(plan.issues.filter((i) => i.level === 'warn').length, 0, '撞课不是用户犯错，不报 warn');
  assert.equal(plan.issues.filter((i) => i.level === 'error').length, 0);
  assert.equal(r.blocks.length, 1, '原计划里的课还在');
});

test('撞软块 → 软块顺延，两边都在（不是吞掉，也不是重叠）', () => {
  const blocks = [blk({ id: 's1', startMin: 900, endMin: 960 })];
  const r = applyLongLocks(weekPlan(blocks, 5), placements, levels, 5, bounds);
  assert.deepEqual(r.reserved, ['odd-d2-study-900-1020']);
  const locked = r.blocks.find((b) => b.id === 'odd-d2-study-900-1020');
  const soft = r.blocks.find((b) => b.id === 's1');
  assert.ok(locked && soft, '两个块都要在');
  assert.ok(soft.startMin >= locked.endMin, '软块让路后不得与它有重叠');
  assert.ok(r.displaced.length > 0, '被挪过的块要报出来（UI 才好标注）');
});

test('没有长期锁时完全不动计划（不产生任何副作用）', () => {
  const blocks = [blk({ id: 's1', startMin: 900, endMin: 960 })];
  const plan = weekPlan(blocks, 5);
  const r = applyLongLocks(plan, {}, {}, 5, bounds);
  assert.deepEqual(r.blocks, blocks);
  assert.equal(plan.issues.length, 0);
});
