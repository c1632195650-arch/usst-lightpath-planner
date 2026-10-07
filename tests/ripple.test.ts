/**
 * R1 测试：拖拽 + 自动顺延
 * ============================================================
 * 守的四件事：
 *   1. **跨天拖拽后 id 不变** —— 这是「churn 不虚高 / 锁不失效」的前提（R1.3）
 *   2. **软块自动顺延**、**遇课程跳过/拒绝**
 *   3. **10 分钟吸附**
 *   4. **放不下 = 拒绝落位**（不制造重叠）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock, WeekPlan } from '@/types';
import { dragTo } from '@/lib/planner/ripple';
import { applyPendingMoves, type MoveRecord } from '@/features/week/userPlanStore';

const D2 = 2 as TimeBlock['dayOfWeek'];
const D4 = 4 as TimeBlock['dayOfWeek'];

function blk(over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startMin' | 'endMin'>): TimeBlock {
  return { kind: 'study', dayOfWeek: D2, title: over.id, source: 'template', ...over } as TimeBlock;
}
const bounds = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 };

test('拖到同一天空档 → 只有被拖的那条记录，位置吸附到 10 分钟', () => {
  const blocks = [blk({ id: 's1', startMin: 600, endMin: 660 })];
  const r = dragTo(blocks, 's1', 2, 607, bounds);
  assert.equal(r.ok, true);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].startMin, 610, '落点必须吸附到 10 分钟档');
  assert.equal(r.records[0].endMin, 670, '时长保持不变');
  assert.equal(r.records[0].source, 'drag');
});

test('压到软块 → 软块顺延（source=ripple），两个都还在且不重叠', () => {
  const blocks = [
    blk({ id: 's1', startMin: 600, endMin: 660 }),
    blk({ id: 's2', startMin: 610, endMin: 670 }),
  ];
  const r = dragTo(blocks, 's1', 2, 610, bounds);
  assert.equal(r.ok, true);
  const rec = (id: string) => r.records.find((x) => x.blockId === id);
  assert.equal(rec('s1')?.source, 'drag', '用户拖的那块是 hard');
  assert.equal(rec('s2')?.source, 'ripple', '被挤开的是 soft —— 引擎后续还可以调');
  assert.ok((rec('s2')?.startMin ?? 0) >= (rec('s1')?.endMin ?? 0), '顺延后不得重叠');
});

test('拖到课程时段 → 拒绝落位（课程永不让步）', () => {
  const blocks = [
    blk({ id: 's1', startMin: 600, endMin: 660 }),
    blk({ id: 'c1', startMin: 700, endMin: 800, kind: 'course', source: 'course' }),
  ];
  const r = dragTo(blocks, 's1', 2, 710, bounds);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /课/);
  assert.deepEqual(r.records, [], '拒绝时不写任何记录');
});

test('课程块不能拖 —— 课程时间要用「调课」改', () => {
  const blocks = [blk({ id: 'c1', startMin: 700, endMin: 800, kind: 'course', source: 'course' })];
  const r = dragTo(blocks, 'c1', 3, 900, bounds);
  assert.equal(r.ok, false);
  assert.deepEqual(r.records, []);
});

test('跨天拖拽：**id 原样保留**，只有位置记录改天', () => {
  const blocks = [
    blk({ id: 'w3-d2-study-lib-2', startMin: 600, endMin: 660 }),
    blk({ id: 'other-d4', startMin: 600, endMin: 660, dayOfWeek: D4 }),
  ];
  const r = dragTo(blocks, 'w3-d2-study-lib-2', 4, 900, bounds);
  assert.equal(r.ok, true);
  const moved = r.records.find((x) => x.blockId === 'w3-d2-study-lib-2');
  assert.ok(moved);
  assert.equal(moved.dayOfWeek, 4);
  // ★ 关键：id 里的 `d2` 段**没有**被重写 —— 重写会让引擎认成「删一个 + 新增一个」
  assert.equal(moved.blockId, 'w3-d2-study-lib-2');
});

test('applyPendingMoves：块的集合一个不多一个不少（因此 churn 不会算成删除+新增）', () => {
  const blocks = [
    blk({ id: 'a', startMin: 600, endMin: 660 }),
    blk({ id: 'b', startMin: 700, endMin: 760 }),
  ];
  const plan: WeekPlan = {
    weekNo: 3, blocks,
    issues: [],
    stats: { courseMin: 0, studyMin: 120, blankMin: 0, blockCount: 2 },
  };
  const moves = new Map<string, MoveRecord>([
    ['a', { weekNo: 3, blockId: 'a', dayOfWeek: 4, startMin: 900, endMin: 960, source: 'drag' }],
    ['b', { weekNo: 3, blockId: 'b', dayOfWeek: 4, startMin: 970, endMin: 1030, source: 'ripple' }],
  ]);
  const out = applyPendingMoves(plan, moves);
  const idsAfter = out.blocks.map((b) => b.id).sort();
  assert.deepEqual(idsAfter, ['a', 'b'], '既不能多也不能少 —— 多了/少了都会被 churn 计成增删');
  const a = out.blocks.find((b) => b.id === 'a')!;
  assert.deepEqual([a.dayOfWeek, a.startMin], [4, 900], '位置换成记录里的值');
  assert.equal(a.title, 'a', '身份信息沿用原块');
});

test('没有 move 记录时返回原计划（同一个引用，不制造无谓渲染）', () => {
  const blocks = [blk({ id: 'a', startMin: 600, endMin: 660 })];
  const plan: WeekPlan = {
    weekNo: 3, blocks, issues: [],
    stats: { courseMin: 0, studyMin: 60, blankMin: 0, blockCount: 1 },
  };
  assert.equal(applyPendingMoves(plan, new Map()), plan);
});

test('塞不下的那天 → 拒绝，并如实说明有几处被挤出', () => {
  const blocks = [
    blk({ id: 's1', startMin: 600, endMin: 660 }),
    blk({ id: 'big', startMin: 1380, endMin: 1439 }),
  ];
  const r = dragTo(blocks, 's1', 2, 1385, bounds);
  assert.equal(r.ok, false, '放不下就必须拒绝，绝不制造重叠');
  assert.match(r.reason ?? '', /放不下/);
  assert.deepEqual(r.records, []);
});

/* ============================================================
 * 2026-10-07 补：套用位置覆盖前先查碰撞
 * ------------------------------------------------------------
 * 起因（RAY 报）：屏幕上出现「16:05 跑步」与「16:10 长目标」互相压住，
 * 而头部仍显示「硬约束违反 0」。根因是 `moves` 是**历史记录**，
 * 重排后引擎产出新布局，一条旧改动可能正好压住新排出来的块 ——
 * 且引擎的 hardViolations 看不见这里（它算的是自己那份 plan）。
 * 口径：撞了就**不套用这一条**、退回引擎位置，并如实报一条 issue。
 * ========================================================== */

test('套用位置覆盖：与别的块撞了 → 这一条不套用，退回引擎位置并如实报 lock-conflict', () => {
  const blocks = [
    blk({ id: 'run', startMin: 965, endMin: 1010 }),   // 16:05–16:50，引擎排的
    blk({ id: 'goal', startMin: 700, endMin: 760 }),   // 引擎原本给它 11:40–12:40
  ];
  const plan: WeekPlan = {
    weekNo: 3, blocks, issues: [],
    stats: { courseMin: 0, studyMin: 105, blankMin: 0, blockCount: 2 },
  };
  // 一条**旧**改动：把 goal 改到 16:10–16:30 —— 正好压在 run（16:05–16:50）上
  const moves = new Map<string, MoveRecord>([
    ['goal', { weekNo: 3, blockId: 'goal', dayOfWeek: 2, startMin: 970, endMin: 990, source: 'edit' }],
  ]);
  const out = applyPendingMoves(plan, moves);

  const goal = out.blocks.find((b) => b.id === 'goal')!;
  assert.deepEqual(
    [goal.startMin, goal.endMin], [700, 760],
    '撞了的改动不得套用 —— 否则屏幕上就是两块叠着，而引擎还报「违反 0」',
  );
  assert.equal(out.blocks.length, 2, '块数不变（只退回位置，不删块）');
  const issues = out.issues.filter((i) => i.code === 'lock-conflict');
  assert.equal(issues.length, 1, '必须如实报一条 lock-conflict（静默退回 = 用户以为白改了）');
  assert.ok(issues[0].message.includes('goal') && issues[0].message.includes('run'),
    '消息里要说清「谁和谁撞了」');
});

test('套用位置覆盖：相接（前者 end == 后者 start）不算撞，照常套用', () => {
  const blocks = [
    blk({ id: 'a', startMin: 600, endMin: 660 }),
    blk({ id: 'b', startMin: 700, endMin: 760 }),
  ];
  const plan: WeekPlan = {
    weekNo: 3, blocks, issues: [],
    stats: { courseMin: 0, studyMin: 120, blankMin: 0, blockCount: 2 },
  };
  // a 改成 640–700：正好顶到 b 的起点，属于合法相邻
  const moves = new Map<string, MoveRecord>([
    ['a', { weekNo: 3, blockId: 'a', dayOfWeek: 2, startMin: 640, endMin: 700, source: 'edit' }],
  ]);
  const out = applyPendingMoves(plan, moves);
  const a = out.blocks.find((b) => b.id === 'a')!;
  assert.deepEqual([a.startMin, a.endMin], [640, 700], '半开区间判定：相接不冲突，应当套用');
  assert.equal(out.issues.filter((i) => i.code === 'lock-conflict').length, 0, '不该误报');
});
