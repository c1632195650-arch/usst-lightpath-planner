/**
 * T1.2 目标函数验收（规格书 §9-T1.2 / §10 AC）
 *   · 7 个分项之和 === total（构造上恒等）
 *   · 已知「优 / 劣」两版计划 → 优者 cost 更低
 *   · §12.5.8 全局口径：校区未知不罚；课程楼不误罚（§13.7 的回归）
 *   · 确定性：同输入两次结果逐字节相同
 *   · 锁：hard 块位移按 ×100 计 churn
 *
 * ⚠️ 顶部注释禁止出现测试 glob 的星号斜杠组合（会提前闭合块注释）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_WEIGHTS, type Commit } from '@/lib/planner/model.ts';
import {
  commitOverdue, dayCampusOf, evaluate, evaluateDelta, transferPenalty,
} from '@/lib/planner/objective.ts';
import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';

const POLICY: PhasePolicy = {
  dailyStudyMin: 60,
  maxBlockMin: 120,
  blankRatio: 0.2,
  eveningAllowed: true,
  weekendWork: false,
  studyPlaces: ['图书馆（图文信息中心）'],
};

const ctx = (extra: Record<string, unknown> = {}) => ({
  weekNo: 1, policy: POLICY, weights: DEFAULT_WEIGHTS, ...extra,
}) as Parameters<typeof evaluate>[1];

function blk(o: {
  id?: string;
  kind: TimeBlock['kind'];
  dayOfWeek: TimeBlock['dayOfWeek'];
  startMin: number;
  endMin: number;
  title?: string;
  place?: string;
  courseId?: string;
}): TimeBlock {
  const b: TimeBlock = {
    id: o.id ?? `b-${o.kind}-d${o.dayOfWeek}-${o.startMin}`,
    kind: o.kind,
    dayOfWeek: o.dayOfWeek,
    startMin: o.startMin,
    endMin: o.endMin,
    title: o.title ?? o.kind,
    source: o.kind === 'course' ? 'course' : 'template',
  };
  if (o.place !== undefined) b.place = o.place;
  if (o.courseId !== undefined) b.courseId = o.courseId;
  return b;
}

function plan(blocks: TimeBlock[], weekNo = 1): WeekPlan {
  return {
    weekNo,
    blocks,
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
    issues: [],
  };
}

/* ============================================================
 * 1. 分项与 total
 * ========================================================== */

test('7 个分项之和 === total（恒等式，无浮点误差）', () => {
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼', courseId: 'C1' }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '逸兴楼' }),
    blk({ kind: 'meal', dayOfWeek: 2, startMin: 760, endMin: 800, place: '思餐厅' }),
  ]);
  const c = evaluate(p, ctx());
  const sum = c.studyShortfall + c.blankDeficit + c.switchCost + c.transferRisk
    + c.dueOverdue + c.churn + c.placeMismatch;
  assert.equal(c.total, sum);
});

test('已知「优 / 劣」两版 → 优者 cost 更低（AC-3 的同构最小例）', () => {
  const days: TimeBlock['dayOfWeek'][] = [1, 2, 3, 4, 5];
  // 优：周一到周五各 60 分钟自习 → 达标（studyShortfall = 0，total = 0）
  const good = plan(days.map((d) => blk({ kind: 'study', dayOfWeek: d, startMin: 600, endMin: 660, place: '图书馆（图文信息中心）' })));
  // 劣：只排两天共 180 分钟（自习总量不足），且第一天在两处不同地点/科目间来回（切换 + 通勤成本）
  const bad = plan([
    blk({ kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660, place: '图书馆（图文信息中心）', title: '高数' }),
    blk({ kind: 'study', dayOfWeek: 1, startMin: 660, endMin: 720, place: '逸兴楼', title: '英语' }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 600, endMin: 660, place: '图书馆（图文信息中心）', title: '高数' }),
  ]);
  const cg = evaluate(good, ctx());
  const cb = evaluate(bad, ctx());
  assert.ok(cg.total < cb.total, `优者应更低：good=${cg.total} bad=${cb.total}`);
  assert.equal(cg.raw.studyMin, 300);
  assert.equal(cb.raw.studyMin, 180); // 比达标线差 120 分钟 → 缺口项必然更大
  assert.ok(cb.studyShortfall > cg.studyShortfall);
  assert.ok(cb.switchCost > 0 && cb.transferRisk > 0, '劣版应同时产生切换与通勤成本');
});

test('确定性：同输入两次 evaluate 结果深度相等', () => {
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 3, startMin: 480, endMin: 570, place: '卓越楼' }),
    blk({ kind: 'study', dayOfWeek: 3, startMin: 600, endMin: 660, place: '卓越楼' }),
  ]);
  assert.deepEqual(evaluate(p, ctx()), evaluate(p, ctx()));
});

/* ============================================================
 * 2. §12.5.8 / §13.7：校区口径（这条是硬要求）
 * ========================================================== */

test('★ §13.7 回归：课程楼不得产生 placeMismatch 惩罚', () => {
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼', courseId: 'C1' }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '逸兴楼' }),
  ]);
  const c = evaluate(p, ctx());
  assert.equal(c.raw.unknownCampusBlocks, 0, '国合楼/逸兴楼 都应能解析出校区（§13.7 已修）');
  assert.equal(c.raw.mismatchedBlocks, 0);
  assert.equal(c.placeMismatch, 0);
});

test('★ §12.5.8：校区未知的块**不惩罚也不排除**', () => {
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼' }),
    blk({ kind: 'study', dayOfWeek: 4, startMin: 600, endMin: 660, place: '某个没登记的楼' }),
  ]);
  const c = evaluate(p, ctx());
  assert.equal(c.raw.unknownCampusBlocks, 1, '未登记地点应被记为「未知」，而不是「错配」');
  assert.equal(c.raw.mismatchedBlocks, 0);
  assert.equal(c.placeMismatch, 0, 'null 校区不产生任何 cost');
});

test('对照：真跨校区**会**被罚（证明不是「一律免罚」）', () => {
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼' }),      // 南校
    blk({ kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '第三教学楼' }),    // 北校
  ]);
  const c = evaluate(p, ctx());
  assert.equal(c.raw.mismatchedBlocks, 1);
  assert.equal(c.placeMismatch, DEFAULT_WEIGHTS.placeMismatch * 1);
});

test('dayCampusOf：当天主校区由**课程块**决定', () => {
  const m = dayCampusOf(plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼' }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '第三教学楼' }),
  ]));
  assert.equal(m.get(2), 'JG334');
});

/* ============================================================
 * 3. 锁与 churn
 * ========================================================== */

test('锁：hard ×100 ≫ soft ×1 ≫ free ×0.08（2026-09-19 §5.5 修订后 free 非零）', () => {
  const prev = plan([blk({ id: 'k1', kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660 })]);
  const next = plan([blk({ id: 'k1', kind: 'study', dayOfWeek: 1, startMin: 660, endMin: 720 })]);
  const free = evaluate(next, ctx({ previousPlan: prev }));
  const soft = evaluate(next, ctx({ previousPlan: prev, lockLevels: { k1: 'soft' } }));
  const hard = evaluate(next, ctx({ previousPlan: prev, lockLevels: { k1: 'hard' } }));
  // free 由 0 改为小非零：挪动 60 分钟的引擎软块 = 0.8 × 0.08 × 60 = 3.84 分
  assert.equal(free.churn, DEFAULT_WEIGHTS.churn * 0.08 * 60);
  assert.equal(soft.churn, DEFAULT_WEIGHTS.churn * 1 * 60);
  assert.equal(hard.churn, DEFAULT_WEIGHTS.churn * 100 * 60);
  // 三级秩序：hard ≫ soft ≫ free > 0（旧的「free = 0」已被规格修订取代）
  assert.ok(hard.total > soft.total && soft.total > free.total && free.churn > 0);
  assert.equal(evaluateDelta(next, next, ctx()), 0);
});

/* ============================================================
 * 4. 分项单元
 * ========================================================== */

test('transferPenalty：同地点 0 / 迟到 10 / 偏紧 3 / 正常 1', () => {
  const a = blk({ kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660, place: 'A' });
  const same = blk({ kind: 'study', dayOfWeek: 1, startMin: 660, endMin: 700, place: 'A' });
  const late = blk({ kind: 'study', dayOfWeek: 1, startMin: 650, endMin: 700, place: 'B' });
  const tight = blk({ kind: 'study', dayOfWeek: 1, startMin: 663, endMin: 700, place: 'B' });
  const ok = blk({ kind: 'study', dayOfWeek: 1, startMin: 680, endMin: 700, place: 'B' });
  assert.equal(transferPenalty(a, same), 0);
  assert.equal(transferPenalty(a, late), 10);
  assert.equal(transferPenalty(a, tight), 3);
  assert.equal(transferPenalty(a, ok), 1);
});

const cm = (dueAt?: Commit['dueAt']): Commit => ({
  id: 't1', title: '写报告', kind: 'activity', effortMin: 60, ...(dueAt ? { dueAt } : {}),
});

test('commitOverdue：未排且逾期 = 10+天数；排入但晚于交期 = 5；按时 = 0', () => {
  const empty = plan([]);
  // 第 1 周的周三到期，而当前就是第 1 周 → 未逾期
  assert.equal(commitOverdue(cm({ weekNo: 1, dayOfWeek: 3, min: 600 }), empty, 1), 0);
  // 第 0 周周三到期：相对当前周(第1周)周一 = 逾期 5 天 → 10 + 5 = 15
  assert.equal(commitOverdue(cm({ weekNo: 0, dayOfWeek: 3, min: 600 }), empty, 1), 15);
  // 第 0 周周一到期：相对当前周周一 = 逾期 7 天 → 10 + 7 = 17
  assert.equal(commitOverdue(cm({ weekNo: 0, dayOfWeek: 1, min: 600 }), empty, 1), 17);
  // 排在第 5 天，但交期是第 3 天 → 5
  const late = plan([blk({ id: 'x-t1', kind: 'activity', dayOfWeek: 5, startMin: 600, endMin: 660 })]);
  assert.equal(commitOverdue(cm({ weekNo: 1, dayOfWeek: 3, min: 600 }), late, 1), 5);
  // 排在交期当天 → 0
  const onTime = plan([blk({ id: 'x-t1', kind: 'activity', dayOfWeek: 3, startMin: 600, endMin: 660 })]);
  assert.equal(commitOverdue(cm({ weekNo: 1, dayOfWeek: 3, min: 600 }), onTime, 1), 0);
});

test('交期项确实进入 total（有交期且逾期 → cost 变大）', () => {
  const p = plan([blk({ kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660 })]);
  const noDue = evaluate(p, ctx({ commits: [cm()] }));
  const overdue = evaluate(p, ctx({ commits: [cm({ weekNo: 0, dayOfWeek: 3, min: 600 })] }));
  assert.equal(noDue.dueOverdue, 0);
  assert.equal(overdue.raw.overdueUnits, 15); // 第0周周三 = 逾期 5 天（见 §5.6 daysOverdue）
  assert.equal(overdue.dueOverdue, DEFAULT_WEIGHTS.dueOverdue * 15);
  assert.ok(overdue.total > noDue.total);
});
