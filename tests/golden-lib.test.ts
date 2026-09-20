/**
 * Golden 工具自检（T1.6 / A4）
 *   · 规范化口径（AC-2）：只留内容、剥离 id 与元数据；排序稳定
 *   · 硬约束判定（AC-1）：重叠与迟到转场都能被抓住
 *   · 指标（AC-3 的基础）：cost 与 objective::evaluate 一致
 *   · 语料自检：5 份 golden 输入都能跑出「零硬违反」的合法计划，且确定性
 *
 * ⚠️ 顶部注释禁止出现「星号 + 斜杠」的连续写法（会提前闭合块注释）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TimeBlock, WeekPlan } from '@/types';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import {
  defaultEvalContext, diffJson, hardViolations, normalizeBlock, normalizePlan, planMetrics,
} from './golden-lib.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import { buildWeekPlan } from '@/lib/planner/schedule.ts';

function blk(o: {
  id?: string;
  kind: TimeBlock['kind'];
  dayOfWeek: TimeBlock['dayOfWeek'];
  startMin: number;
  endMin: number;
  title?: string;
  place?: string;
  transfer?: TimeBlock['transfer'];
  reason?: string;
  locked?: boolean;
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
  if (o.transfer !== undefined) b.transfer = o.transfer;
  if (o.reason !== undefined) b.reason = o.reason;
  if (o.locked !== undefined) b.locked = o.locked;
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

/* ---------------- ① 规范化口径（AC-2） ---------------- */

test('normalizeBlock：只留「时间/类型/标题/地点」，剥离 id 与元数据', () => {
  const b = blk({
    id: 'w1-d2-study-高数', kind: 'study', dayOfWeek: 2, startMin: 600, endMin: 660,
    title: '高数', place: '图书馆（图文信息中心）', reason: '因为…', locked: true,
  });
  assert.deepEqual(normalizeBlock(b), {
    dayOfWeek: 2, startMin: 600, endMin: 660, kind: 'study', title: '高数', place: '图书馆（图文信息中心）',
  });
});

test('normalizeBlock：无地点统一为 null（不是 undefined，便于 JSON 往返比较）', () => {
  const b = blk({ kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660 });
  assert.equal(normalizeBlock(b).place, null);
});

test('normalizePlan：与原始块顺序无关（排序稳定）', () => {
  const a = blk({ kind: 'study', dayOfWeek: 2, startMin: 600, endMin: 660, title: 'B' });
  const b = blk({ kind: 'course', dayOfWeek: 1, startMin: 480, endMin: 570, title: 'A' });
  const c = blk({ kind: 'meal', dayOfWeek: 2, startMin: 700, endMin: 740, title: 'C' });
  assert.deepEqual(normalizePlan(plan([a, b, c])), normalizePlan(plan([c, b, a])));
  // 排序键：天升序优先
  assert.deepEqual(normalizePlan(plan([a, b, c])).map((x) => x.title), ['A', 'B', 'C']);
});

/* ---------------- ② 硬约束（AC-1） ---------------- */

test('hardViolations：同一天重叠被计入（含嵌套，不只相邻）', () => {
  const nested = plan([
    blk({ kind: 'course', dayOfWeek: 1, startMin: 480, endMin: 720, title: '长课' }),
    blk({ kind: 'meal', dayOfWeek: 1, startMin: 540, endMin: 570, title: '被夹住' }),
  ]);
  const hv = hardViolations(nested);
  assert.equal(hv.overlaps, 1, '嵌套重叠必须被抓住（只比相邻会漏）');
  assert.equal(hv.total, 1);

  const ok = plan([
    blk({ kind: 'course', dayOfWeek: 1, startMin: 480, endMin: 570 }),
    blk({ kind: 'meal', dayOfWeek: 1, startMin: 570, endMin: 600 }),
  ]);
  assert.equal(hardViolations(ok).total, 0, '首尾相接不算重叠');
});

test('hardViolations：转场余量为负 = 迟到，计入违反', () => {
  const late = plan([
    blk({
      kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660,
      transfer: { fromPlace: 'A', toPlace: 'B', minutes: 20, slackMin: -5, tight: true },
    }),
  ]);
  assert.equal(hardViolations(late).lateTransfers, 1);
  assert.equal(hardViolations(late).total, 1);

  const tightButOk = plan([
    blk({
      kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660,
      transfer: { fromPlace: 'A', toPlace: 'B', minutes: 20, slackMin: 3, tight: true },
    }),
  ]);
  assert.equal(hardViolations(tightButOk).lateTransfers, 0, '偏紧但没迟到不算硬违反');
});

/* ---------------- ③ 指标 ---------------- */

test('planMetrics：cost 与 objective::evaluate 完全一致（不另立口径）', () => {
  const policy = { dailyStudyMin: 60, maxBlockMin: 120, blankRatio: 0.2, eveningAllowed: true, weekendWork: false, studyPlaces: ['图书馆（图文信息中心）'] };
  const p = plan([
    blk({ kind: 'course', dayOfWeek: 2, startMin: 600, endMin: 690, place: '国合楼' }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 700, endMin: 760, place: '逸兴楼' }),
  ]);
  const ctx = defaultEvalContext(1, policy);
  const m = planMetrics(p, ctx);
  assert.equal(m.cost, evaluate(p, ctx).total);
  assert.equal(m.blockCount, 2);
  assert.equal(m.courseMin, 90);
  assert.equal(m.studyMin, 60);
  assert.equal(m.errorIssues + m.warnIssues + m.infoIssues, 0);
});

test('planMetrics：软目标达成率封顶 1，不会因超额而 >1', () => {
  const policy = { dailyStudyMin: 10, maxBlockMin: 600, blankRatio: 0, eveningAllowed: true, weekendWork: false, studyPlaces: [] };
  const p = plan([
    blk({ kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660 }),
    blk({ kind: 'study', dayOfWeek: 2, startMin: 600, endMin: 660 }),
  ]);
  const m = planMetrics(p, defaultEvalContext(1, policy));
  assert.ok(m.soft.studyAchieved <= 1 && m.soft.studyAchieved > 0);
  assert.equal(m.soft.blankKept, 1, 'blankRatio=0 → 无留白要求，视为达成');
});

/* ---------------- ④ 语料自检 ---------------- */

test('语料：5 份 golden 输入都能跑出「零硬违反」的合法计划', () => {
  assert.ok(GOLDEN_INPUTS.length >= 4, `语料太少：${GOLDEN_INPUTS.length}`);
  for (const g of GOLDEN_INPUTS) {
    const { plan: p } = buildWeekPlan(buildGoldenInput(g));
    const hv = hardViolations(p);
    assert.equal(hv.total, 0, `${g.name} 出现硬约束违反：重叠 ${hv.overlaps} / 迟到 ${hv.lateTransfers}`);
    assert.ok(p.blocks.length > 0, `${g.name} 排出了空计划`);
  }
});

test('语料：同一输入两次构建逐块一致（确定性）', () => {
  for (const g of GOLDEN_INPUTS) {
    const one = normalizePlan(buildWeekPlan(buildGoldenInput(g)).plan);
    const two = normalizePlan(buildWeekPlan(buildGoldenInput(g)).plan);
    assert.equal(diffJson(one, two), null, `${g.name} 两次构建结果不一致`);
  }
});

test('diffJson：相等返回 null，不等给出差异描述', () => {
  assert.equal(diffJson({ a: 1 }, { a: 1 }), null);
  assert.ok(diffJson({ a: 1 }, { a: 2 }));
});
