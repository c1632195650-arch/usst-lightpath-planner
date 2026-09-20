/**
 * R4 / R5 / R6 测试
 * ============================================================
 *   · R4.1 多条不可时段**并存**（不互相覆盖）
 *   · R4.3 用途登记（activityStore 的纯函数 + 与 behaviorLog 不混）
 *   · R5.3 聚合（**唯一聚合点**，且不由存储双写）
 *   · R6.1 定点修改：**其它天的块集合不变**
 *   · R6.2 不可时段像硬约束一样生效（软事挪开，课程不动）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock, WeekPlan } from '@/types';
import { applyUnavailableSlots, slotActiveThisWeek, type UnavailableSlotLike } from '@/lib/planner/unavailableSlots';
import { diffDays, localizedPlan, unionAffectedDays } from '@/lib/planner/localizedReplan';
import {
  addEntry, entriesOfWeek, removeEntry, upsertEntry, type ActivityEntry,
} from '@/features/activity/activityStore';
import { humanHours, summarizeRange, summarizeWeek, totalForGoal } from '@/features/activity/aggregate';
import type { Goal } from '@/features/activity/goalStore';

const D3 = 3 as TimeBlock['dayOfWeek'];
const D5 = 5 as TimeBlock['dayOfWeek'];

function blk(o: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startMin' | 'endMin'>): TimeBlock {
  return { kind: 'study', dayOfWeek: D3, title: o.id, source: 'template', ...o } as TimeBlock;
}
function plan(blocks: TimeBlock[], weekNo = 5): WeekPlan {
  return {
    weekNo, blocks, issues: [],
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
  };
}
const bounds = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 };

/* ---------------- R4.1 多条不可时段并存 ---------------- */

test('两条不可时段并存且都生效 —— 不是后一条覆盖前一条', () => {
  const slots: UnavailableSlotLike[] = [
    { id: 'a', days: [3], fromMin: 14 * 60, toMin: 18 * 60, weeks: [5], scope: 'once', createdAtWeek: 5 },
    { id: 'b', days: [5], fromMin: 8 * 60, toMin: 10 * 60, weeks: [5], scope: 'once', createdAtWeek: 5 },
  ];
  const blocks = [
    blk({ id: 's1', startMin: 15 * 60, endMin: 16 * 60 }),
    blk({ id: 's2', startMin: 8 * 60 + 30, endMin: 9 * 60, dayOfWeek: D5 }),
  ];
  const p = plan(blocks, 5);
  const r = applyUnavailableSlots(p, slots, 5, bounds);
  assert.equal(r.applied.length, 2, '两条都要生效');
  assert.deepEqual(r.moved.sort(), ['s1', 's2'], '两条各自都把占位的块赶走了');
  const s1 = r.blocks.find((b) => b.id === 's1')!;
  const s2 = r.blocks.find((b) => b.id === 's2')!;
  assert.ok(!(s1.startMin < 18 * 60 && 14 * 60 < s1.endMin), '周三下午不能有事');
  assert.ok(!(s2.startMin < 10 * 60 && 8 * 60 < s2.endMin), '周五上午也不能有事');
});

test('长期声明：只影响创建之后的周（读法 A），之前的周不受牵连', () => {
  const s: UnavailableSlotLike = {
    id: 'a', days: [3], fromMin: 8 * 60, toMin: 12 * 60, weeks: [], scope: 'long', createdAtWeek: 8,
  };
  assert.equal(slotActiveThisWeek(s, 6), false, '第 6 周还没说过这句话');
  assert.equal(slotActiveThisWeek(s, 9), true);
  assert.equal(slotActiveThisWeek({ ...s, weeks: [5] }, 5), true, '一次性声明在指定周生效');
  assert.equal(slotActiveThisWeek({ ...s, weeks: [5] }, 6), false);
});

test('课程不让位 —— 课落在声明时段里也照常上课', () => {
  const slots: UnavailableSlotLike[] = [
    { id: 'a', days: [3], fromMin: 8 * 60, toMin: 12 * 60, weeks: [5], scope: 'once', createdAtWeek: 5 },
  ];
  const course = blk({ id: 'c1', startMin: 8 * 60, endMin: 9 * 60 + 40, kind: 'course', source: 'course' });
  const p = plan([course], 5);
  const r = applyUnavailableSlots(p, slots, 5, bounds);
  const c = r.blocks.find((b) => b.id === 'c1')!;
  assert.deepEqual([c.startMin, c.endMin], [8 * 60, 9 * 60 + 40], '课程纹丝不动');
  assert.deepEqual(r.moved, []);
});

test('挤不开的块被去掉，并留下一条 info（不静默吞掉）', () => {
  const slots: UnavailableSlotLike[] = [
    { id: 'a', days: [3], fromMin: 7 * 60, toMin: 23 * 60, weeks: [5], scope: 'once', createdAtWeek: 5 },
  ];
  const p = plan([blk({ id: 's1', startMin: 15 * 60, endMin: 16 * 60 })], 5);
  const r = applyUnavailableSlots(p, slots, 5, bounds);
  assert.deepEqual(r.dropped, ['s1']);
  assert.equal(r.blocks.length, 0);
  assert.equal(p.issues.length, 1, '去掉就得说一句');
  assert.equal(p.issues[0].level, 'info');
});

/* ---------------- R4.3 / R5.3 活动登记与聚合 ---------------- */

function entry(o: Partial<ActivityEntry> & Pick<ActivityEntry, 'id' | 'weekNo' | 'minutes'>): ActivityEntry {
  return {
    date: '2026-09-10', title: '建模', tag: 'interest', source: 'occupied',
    at: '2026-09-10T12:00:00.000Z', ...o,
  } as ActivityEntry;
}

test('登记：增删改与某周筛选', () => {
  const a = entry({ id: 'a', weekNo: 5, minutes: 60 });
  let list = addEntry([], a);
  assert.equal(entriesOfWeek(list, 5).length, 1);
  assert.equal(entriesOfWeek(list, 6).length, 0, '周次要分得清');
  list = upsertEntry(list, { ...a, minutes: 90 });
  assert.equal(list.length, 1, '同一 id 是修改不是新增');
  assert.equal(list[0].minutes, 90);
  list = removeEntry(list, 'a');
  assert.equal(list.length, 0);
});

test('聚合：按目标 / 按标签累计，都是从明细现算（没有存下来的合计）', () => {
  const goal: Goal = { id: 'g1', title: '数学建模', emoji: '🏆', kind: 'contest', targetMinutes: 600 };
  const list: ActivityEntry[] = [
    entry({ id: 'a', weekNo: 3, minutes: 120, tag: 'goal', goalId: 'g1' }),
    entry({ id: 'b', weekNo: 5, minutes: 180, tag: 'goal', goalId: 'g1' }),
    entry({ id: 'c', weekNo: 5, minutes: 60, tag: 'interest' }),
  ];
  assert.equal(totalForGoal(list, 'g1'), 300);
  const r = summarizeRange(list, 1, 5, [goal]);
  assert.equal(r.totalMin, 360);
  assert.equal(r.byGoal[0].minutes, 300);
  assert.equal(r.byGoal[0].progress, 0.5, '有定额才有进度');
  const w5 = summarizeWeek(list, 5);
  assert.equal(w5.totalMin, 240, '第 5 周只算第 5 周的');
  assert.equal(w5.count, 2);
  assert.equal(humanHours(45), '45 分钟');
  assert.equal(humanHours(120), '2 小时');
});

/* ---------------- R6.1 定点修改 ---------------- */

test('只重排指定的天 —— 其它天的块集合逐字节不变', () => {
  const prev = plan([
    blk({ id: 'mon', startMin: 600, endMin: 660, dayOfWeek: 1 as TimeBlock['dayOfWeek'] }),
    blk({ id: 'wed', startMin: 600, endMin: 660 }),
  ], 5);
  const next = plan([
    blk({ id: 'mon2', startMin: 700, endMin: 760, dayOfWeek: 1 as TimeBlock['dayOfWeek'] }),
    blk({ id: 'wed2', startMin: 900, endMin: 960 }),
  ], 5);
  const fused = localizedPlan(prev, next, [3]).plan;
  const keyOf = (b: TimeBlock) => `${b.id}@${b.dayOfWeek}:${b.startMin}-${b.endMin}`;
  const mondayBlocks = fused.blocks.filter((b) => b.dayOfWeek === 1).map(keyOf);
  const wedBlocks = fused.blocks.filter((b) => b.dayOfWeek === 3).map(keyOf);
  assert.deepEqual(mondayBlocks.map((k) => k.includes('mon@')), [true], '周一保持上一版');
  assert.deepEqual(wedBlocks, ['wed2@3:900-960'], '周三是新版');
  // 与上一版比，只有重排的那天（周三）变了；周一保持原样，不该出现在差异里
  assert.deepEqual(diffDays(prev, fused), [3]);
});

test('没有上一版 / 没有定点诉求 → 整体接受新版（不能变成空计划）', () => {
  const next = plan([blk({ id: 'a', startMin: 600, endMin: 660 })], 5);
  assert.deepEqual(localizedPlan(null, next, [3]).plan.blocks, next.blocks);
  assert.deepEqual(localizedPlan(null, next, null).plan.blocks, next.blocks);
});

test('unionAffectedDays：任一要求说不清哪天就退回整周重排', () => {
  assert.deepEqual(unionAffectedDays([{ days: [3] }, { days: [5] }], 5), [3, 5]);
  assert.equal(unionAffectedDays([{ days: [3] }, {}], 5), null, '有一条没指定天 → 不假装知道');
});
