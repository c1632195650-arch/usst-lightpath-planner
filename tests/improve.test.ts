/**
 * T1.3 `improve.ts` 验收（规格书 §5.7 / §9-T1.3）
 *   · 验收硬指标：**cost 单调不增**；**输出确定性**（两次运行逐字节相同）
 *   · 五算子各自「确有作为」：relocate / swap / reassign / resplit(合并) / reschedule-place(首选地点)
 *   · 纪律：硬块（课程 / locked / lockLevels='hard'）**坐标永不变**
 *
 * 手法：为了让「某个算子」成为**唯一**能降本的移动，场景里把其它天填满、并收紧候选地点池，
 *       否则 First-Improvement 会先被更靠前的算子（relocate）吃掉改进。
 *
 * ⚠️ 顶部注释禁止出现「星号 + 斜杠」的连续写法（会提前闭合块注释）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import { BUILTIN_PLACE_INDEX } from '@/lib/planner/places.ts';
import { improve } from '@/lib/planner/improve.ts';
import type { ImproveContext } from '@/lib/planner/improve.ts';
import { buildWeekPlan } from '@/lib/planner/schedule.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { normalizePlan } from './golden-lib.ts';

/* ---------------- 夹具 ---------------- */

function policy(over: Partial<PhasePolicy> = {}): PhasePolicy {
  return {
    dailyStudyMin: 0, maxBlockMin: 60, blankRatio: 0,
    eveningAllowed: false, weekendWork: false,
    studyPlaces: ['图书馆（图文信息中心）'],
    ...over,
  };
}

function ctx(over: Partial<ImproveContext> = {}): ImproveContext {
  return { weekNo: 1, policy: policy(), candidatePlaces: [], config: { maxIterations: 500 }, ...over };
}

function blk(o: {
  id: string;
  kind: TimeBlock['kind'];
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  title?: string;
  place?: string;
  source?: TimeBlock['source'];
  courseId?: string;
  locked?: boolean;
}): TimeBlock {
  const b: TimeBlock = {
    id: o.id,
    kind: o.kind,
    dayOfWeek: o.dayOfWeek as TimeBlock['dayOfWeek'],
    startMin: o.startMin,
    endMin: o.endMin,
    title: o.title ?? o.kind,
    source: o.source ?? (o.kind === 'course' ? 'course' : 'template'),
  };
  if (o.place !== undefined) b.place = o.place;
  if (o.courseId !== undefined) b.courseId = o.courseId;
  if (o.locked !== undefined) b.locked = o.locked;
  return b;
}

/** 占位块：把整天的空档吃光，从而「堵死」relocate */
function fill(id: string, day: number, place: string): TimeBlock {
  return blk({ id, kind: 'activity', dayOfWeek: day, startMin: 420, endMin: 1380, title: `占位${day}`, place });
}

function planOf(blocks: TimeBlock[]): WeekPlan {
  return {
    weekNo: 1,
    blocks,
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
    issues: [],
  };
}

function cost(p: WeekPlan, policyIn: PhasePolicy): number {
  return evaluate(p, { weekNo: 1, policy: policyIn, weights: DEFAULT_WEIGHTS }).total;
}

function byId(p: WeekPlan, id: string): TimeBlock {
  const b = p.blocks.find((x) => x.id === id);
  assert.ok(b, `找不到块 ${id}`);
  return b;
}

function canon(p: WeekPlan): string {
  return JSON.stringify([...p.blocks].sort((a, b) => a.id.localeCompare(b.id)));
}

const GUOHE = [...BUILTIN_PLACE_INDEX.values()].find((p) => p.name === '国合楼');
assert.ok(GUOHE, '内置地点表里应有「国合楼」（§13.7 修复的成果）');

/* ============================================================
 * 1. 验收硬指标：单调不增 + 确定性
 * ========================================================== */

test('★ 验收：对真实构造解跑 improve，cost 单调不增', () => {
  for (const g of GOLDEN_INPUTS) {
    const { plan } = buildWeekPlan(buildGoldenInput(g));
    const c = { weekNo: g.weekNo, policy: g.policy, config: { maxIterations: 400 } } as ImproveContext;
    const before = cost(plan, g.policy);
    const r = improve(plan, c);
    assert.ok(r.costAfter <= before + 1e-9, `${g.name}: ${before} → ${r.costAfter}（不应上升）`);
    assert.equal(r.costAfter, cost(r.plan, g.policy), `${g.name}: 返回的 costAfter 与重算不一致`);
  }
});

test('★ 验收：输出确定性（两次运行逐字节相同）', () => {
  const g = GOLDEN_INPUTS[0];
  const { plan } = buildWeekPlan(buildGoldenInput(g));
  const c = { weekNo: g.weekNo, policy: g.policy, config: { maxIterations: 400 } } as ImproveContext;
  const a = improve(plan, c);
  const b = improve(plan, c);
  assert.equal(canon(a.plan), canon(b.plan), '两次 improve 结果不一致');
  assert.equal(a.accepted.length, b.accepted.length);
  assert.equal(a.costAfter, b.costAfter);
});

test('improve 不修改入参 plan（纯函数纪律）', () => {
  const p = planOf([
    blk({ id: 's1', kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660, place: '图书馆（图文信息中心）' }),
  ]);
  const snapshot = canon(p);
  improve(p, ctx());
  assert.equal(canon(p), snapshot, '入参被改动了');
});

/* ============================================================
 * 2. 硬块不动
 * ========================================================== */

test('硬块（课程）坐标永不变：improve 只动软块', () => {
  const day2 = [
    blk({ id: 'c1', kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, title: '模电', place: '国合楼', courseId: 'C1' }),
    blk({ id: 's1', kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, title: '高数', place: '第三教学楼' }),
    blk({ id: 'f2', kind: 'activity', dayOfWeek: 2, startMin: 760, endMin: 1380, title: '占位2', place: '国合楼' }),
  ];
  const p = planOf([...day2, fill('f1', 1, '国合楼'), fill('f3', 3, '国合楼'), fill('f4', 4, '国合楼'), fill('f5', 5, '国合楼')]);
  const r = improve(p, ctx({ candidatePlaces: ['国合楼'] }));
  const c1 = byId(r.plan, 'c1');
  assert.equal(c1.startMin, 600);
  assert.equal(c1.endMin, 690);
  assert.equal(c1.dayOfWeek, 2);
  for (const f of ['f1', 'f2', 'f3', 'f4', 'f5']) {
    assert.equal(canon(planOf([byId(r.plan, f)])), canon(planOf([byId(p, f)])), `${f} 不该被移动`);
  }
});

test('lockLevels 显式标 hard 的块不可移动（改进被卡住）', () => {
  const p = planOf([
    blk({ id: 'c1', kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼' }),
    blk({ id: 's1', kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '第三教学楼' }),
    blk({ id: 'f2', kind: 'activity', dayOfWeek: 2, startMin: 760, endMin: 1380, place: '国合楼' }),
    fill('f1', 1, '国合楼'), fill('f3', 3, '国合楼'), fill('f4', 4, '国合楼'), fill('f5', 5, '国合楼'),
  ]);
  const free = improve(p, ctx({ candidatePlaces: ['国合楼'] }));
  const locked = improve(p, ctx({ candidatePlaces: ['国合楼'], lockLevels: { s1: 'hard' } }));
  assert.ok(free.costAfter < free.costBefore, '不锁时应能改进');
  assert.equal(locked.costAfter, locked.costBefore, '锁死后不该有任何改进');
  assert.equal(byId(locked.plan, 's1').place, '第三教学楼');
});

/* ============================================================
 * 3. 五算子「确有作为」
 * ========================================================== */

test('reassign：把错校区的自习块换到当天主校区 → placeMismatch 归零', () => {
  // 周2 的课在国合楼（南校 JG334）→ 当天主校区 = 南校；
  // 自习却排在第三教学楼（北校 JG516）→ 校区错配（3.0）+ 跨校区通勤（2.0）
  const p = planOf([
    blk({ id: 'c1', kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, title: '模电', place: '国合楼', courseId: 'C1' }),
    blk({ id: 's1', kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, title: '高数', place: '第三教学楼' }),
    blk({ id: 'f2', kind: 'activity', dayOfWeek: 2, startMin: 760, endMin: 1380, title: '占位2', place: '国合楼' }),
    fill('f1', 1, '国合楼'), fill('f3', 3, '国合楼'), fill('f4', 4, '国合楼'), fill('f5', 5, '国合楼'),
  ]);
  const before = cost(p, policy());
  assert.ok(before > 0);
  const r = improve(p, ctx({ candidatePlaces: ['国合楼'] }));
  assert.equal(byId(r.plan, 's1').place, '国合楼', '应把自习迁到当天主校区的地点');
  assert.ok(r.costAfter < before, `应降本：${before} → ${r.costAfter}`);
  assert.ok(r.accepted.some((m) => m.op === 'reassign'), '应记录 reassign 移动');
});

test('resplit（合并）：两段相邻碎自习（不同科目）合并 → 消掉一次认知切换', () => {
  // 其它天填满 → relocate 无处可去；候选地点池为空 → reassign 无候选；
  // 于是**唯一**的降本移动 = 合并这两段相邻自习（switchCost 0.5 → 0）
  const p = planOf([
    blk({ id: 's1', kind: 'study', dayOfWeek: 1, startMin: 420, endMin: 450, title: '高数', place: '图书馆（图文信息中心）' }),
    blk({ id: 's2', kind: 'study', dayOfWeek: 1, startMin: 450, endMin: 480, title: '英语', place: '图书馆（图文信息中心）' }),
    blk({ id: 'f1', kind: 'activity', dayOfWeek: 1, startMin: 480, endMin: 1380, title: '占位1', place: '图书馆（图文信息中心）' }),
    fill('f2', 2, '图书馆（图文信息中心）'), fill('f3', 3, '图书馆（图文信息中心）'),
    fill('f4', 4, '图书馆（图文信息中心）'), fill('f5', 5, '图书馆（图文信息中心）'),
  ]);
  const before = cost(p, policy());
  const r = improve(p, ctx());
  assert.ok(r.costAfter < before, `应降本：${before} → ${r.costAfter}`);
  assert.ok(r.accepted.some((m) => m.op === 'resplit'), '应记录 resplit 移动');
  const study = r.plan.blocks.filter((b) => b.kind === 'study');
  assert.equal(study.length, 1, '两段碎自习应合并为一段');
  assert.equal(study[0].startMin, 420);
  assert.equal(study[0].endMin, 480);
});

test('reschedule-place：带 placeId 的提交项被迁到首选地点（修校区错配）', () => {
  const p = planOf([
    blk({ id: 'c1', kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, title: '模电', place: '国合楼', courseId: 'C1' }),
    blk({ id: 'w1-d2-activity-t1', kind: 'activity', dayOfWeek: 2, startMin: 700, endMin: 760, title: '写报告', place: '第三教学楼' }),
    blk({ id: 'f2', kind: 'activity', dayOfWeek: 2, startMin: 760, endMin: 1380, title: '占位2', place: '国合楼' }),
    fill('f1', 1, '国合楼'), fill('f3', 3, '国合楼'), fill('f4', 4, '国合楼'), fill('f5', 5, '国合楼'),
  ]);
  const commits = [{ id: 't1', title: '写报告', kind: 'activity' as const, effortMin: 60, placeId: GUOHE.id }];
  const before = cost(p, policy());
  // candidatePlaces 为空 → 排除 plain reassign，只有 reschedule-place 能改地点
  const r = improve(p, ctx({ commits }));
  assert.equal(byId(r.plan, 'w1-d2-activity-t1').place, '国合楼');
  assert.ok(r.costAfter < before, `应降本：${before} → ${r.costAfter}`);
  assert.ok(r.accepted.some((m) => m.op === 'reschedule-place'));
});

test('relocate：把块从「引发切换的位置」平移走 → cost 下降', () => {
  // 两段自习同科目相邻（不产生切换），但第二段与一个**不同地点**的块相邻 → 通勤风险 2.0
  // 平移到更晚的空档、远离不同地点的块 → 降本
  const p = planOf([
    blk({ id: 's1', kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660, title: '高数', place: '图书馆（图文信息中心）' }),
    blk({ id: 'a1', kind: 'activity', dayOfWeek: 1, startMin: 661, endMin: 700, title: '取快递', place: '国合楼' }),
  ]);
  const before = cost(p, policy());
  const r = improve(p, ctx());
  assert.ok(r.accepted.length > 0, '应至少接受一次移动');
  assert.ok(r.costAfter < before, `应降本：${before} → ${r.costAfter}`);
  assert.ok(r.accepted.some((m) => m.op === 'relocate' || m.op === 'swap'), `实际：${JSON.stringify(r.accepted.map((m) => m.op))}`);
});

test('swap：同一天两块互换可降本时会被采用', () => {
  // 设计：当天**填满**（relocate 无处可去）＋候选地点池为空（reassign 无候选）
  //       → 唯一能降本的是「把同校区的两块挪到一起」，即 swap
  // 图书馆(北校) 与 国合楼(南校) 交替 → 每对相邻都跨地点；把 s2 与 a1 换位后
  // 出现 a1/a2 同地点相邻 → 通勤项显著下降
  const p = planOf([
    blk({ id: 's1', kind: 'study', dayOfWeek: 1, startMin: 420, endMin: 480, title: '高数', place: '图书馆（图文信息中心）' }),
    blk({ id: 'a1', kind: 'activity', dayOfWeek: 1, startMin: 480, endMin: 540, title: '取快递', place: '国合楼' }),
    blk({ id: 's2', kind: 'study', dayOfWeek: 1, startMin: 540, endMin: 600, title: '高数', place: '图书馆（图文信息中心）' }),
    blk({ id: 'a2', kind: 'activity', dayOfWeek: 1, startMin: 600, endMin: 660, title: '取外卖', place: '国合楼' }),
    blk({ id: 'f1', kind: 'activity', dayOfWeek: 1, startMin: 660, endMin: 1380, title: '占位1', place: '图书馆（图文信息中心）' }),
    fill('f2', 2, '图书馆（图文信息中心）'), fill('f3', 3, '图书馆（图文信息中心）'),
    fill('f4', 4, '图书馆（图文信息中心）'), fill('f5', 5, '图书馆（图文信息中心）'),
  ]);
  const before = cost(p, policy());
  const r = improve(p, ctx());
  assert.ok(r.costAfter < before, `应降本：${before} → ${r.costAfter}`);
  assert.ok(r.accepted.some((m) => m.op === 'swap'), `应命中 swap，实际：${JSON.stringify(r.accepted.map((m) => m.op))}`);
  assert.equal(r.plan.blocks.length, p.blocks.length, 'swap 不改变块数');
});
