/**
 * buildPhases 的阶段规划测试。
 * 跑法：npm run test:ui（node --test scripts/，Node 24 直接跑 TS）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhases, buildPhasesFromCalendar, phaseOfWeek,
} from '../src/lib/planner/buildPhases.ts';

/* ---------------- 测试夹具 ---------------- */

function slot(dayOfWeek, startPeriod, endPeriod, weeks) {
  return { dayOfWeek, startPeriod, endPeriod, weeks };
}

/** 一门 3-18 周的课 + 一门 7-15 周的课（还原真实课表的周次多样性） */
const schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [
    {
      id: 'c1', name: '大学物理A(2)', teacher: '庞锦毅', credit: 4, category: '公共基础',
      campus: 'JG516', building: '第一教学楼', room: '144',
      slots: [slot(1, 1, 2, range(3, 18)), slot(4, 6, 7, range(3, 18))],
    },
    {
      id: 'c2', name: '大学物理实验(1)', teacher: '马珊珊', credit: 0.5, category: '实践环节',
      campus: 'JG516', building: '公共实验楼', room: '4楼',
      slots: [slot(4, 6, 7, range(7, 15))],
    },
  ],
};

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function persona({ axes = {}, scenarios = {} } = {}) {
  const baseAxes = { EXP: 50, PLAN: 50, SOC: 50, RES: 50, ACH: 50, HEA: 50, RAT: 50, BOLD: 50 };
  const baseScen = {
    meal_radius: 'near', planning: 'planned', event_breadth: 'narrow', social_radius: 'close',
    night_supply: 'convenience', exercise_trigger: 'self_plan', study_place: 'library',
    info_channel: 'self_search',
  };
  return {
    version: 'test-1', scoreVersion: 'test-1',
    axes: { ...baseAxes, ...axes },
    traits: { E: 50, C: 50, ES: 50, O: 50, A: 50 },
    motives: { ACH: 50, SOC: 50, HEA: 50, EXP: 50, STA: 50 },
    scenarios: { ...baseScen, ...scenarios },
    archetype: { primary: null, secondary: null, distance: 0 },
    confidence: {}, quality: 'ok', updatedAt: '2026-09-11T00:00:00Z',
  };
}

/** 阶段必须首尾相接、覆盖 1..totalWeeks，且不重叠 */
function assertContiguous(plan) {
  assert.ok(plan.phases.length > 0, '至少要有一个阶段');
  assert.equal(plan.phases[0].fromWeek, 1, `首个阶段应从第 1 周开始，实际 ${plan.phases[0].fromWeek}`);
  const last = plan.phases[plan.phases.length - 1];
  assert.equal(last.toWeek, plan.totalWeeks, `末个阶段应到第 ${plan.totalWeeks} 周，实际 ${last.toWeek}`);
  for (let i = 1; i < plan.phases.length; i++) {
    const prev = plan.phases[i - 1];
    const cur = plan.phases[i];
    assert.equal(cur.fromWeek, prev.toWeek + 1,
      `第 ${i} 段起点应紧接上一段（上段到 ${prev.toWeek}，本段从 ${cur.fromWeek}）`);
    assert.ok(cur.fromWeek <= cur.toWeek, `阶段 ${cur.kind} 的周次不应倒置`);
  }
}

/* ---------------- 用例 ---------------- */

test('阶段连续且完整覆盖整学期', () => {
  const { plan } = buildPhases(schedule, persona());
  assertContiguous(plan);
  assert.equal(plan.totalWeeks, 20);
});

test('考试周对齐校历：exam 段从第 19 周开始', () => {
  const { plan } = buildPhases(schedule, persona(), { theoryFromWeek: 3, examFromWeek: 19 });
  const exam = plan.phases.find((p) => p.kind === 'exam');
  assert.ok(exam, '应有考试周阶段');
  assert.equal(exam.fromWeek, 19);
  assert.equal(exam.toWeek, 20);
  assertContiguous(plan);
});

test('有课的周次区间来自课表本身（3-18 周），而非硬编码', () => {
  const { notes } = buildPhases(schedule, persona());
  assert.ok(notes.some((n) => n.includes('第 3 周')), `notes 应提到课表周次区间，实际：${notes}`);
});

test('成就驱动高 → 每天目标时长更大，且冲刺更早', () => {
  const low = buildPhases(schedule, persona({ axes: { ACH: 20 } })).plan;
  const high = buildPhases(schedule, persona({ axes: { ACH: 85 } })).plan;

  const normalOf = (p) => p.phases.find((x) => x.kind === 'normal').policy.dailyStudyMin;
  assert.ok(normalOf(high) > normalOf(low),
    `ACH 高(${normalOf(high)}) 应大于 ACH 低(${normalOf(low)})`);

  const sprintFrom = (p) => p.phases.find((x) => x.kind === 'sprint').fromWeek;
  assert.ok(sprintFrom(high) <= sprintFrom(low),
    `ACH 高时冲刺应更早开始或相同（high=${sprintFrom(high)}, low=${sprintFrom(low)}）`);
});

test('健康自律低 → 留白更多（强制休息）', () => {
  const lowHea = buildPhases(schedule, persona({ axes: { HEA: 20 } })).plan;
  const highHea = buildPhases(schedule, persona({ axes: { HEA: 85 } })).plan;
  const blank = (p) => p.phases.find((x) => x.kind === 'normal').policy.blankRatio;
  assert.ok(blank(lowHea) > blank(highHea),
    `HEA 低(${blank(lowHea)}) 应比 HEA 高(${blank(highHea)}) 留白更多`);
});

test('计划性低 → 单块压短，不排长块', () => {
  const lowPlan = buildPhases(schedule, persona({ axes: { PLAN: 20 } })).plan;
  const highPlan = buildPhases(schedule, persona({ axes: { PLAN: 85 } })).plan;
  const blk = (p) => p.phases.find((x) => x.kind === 'normal').policy.maxBlockMin;
  assert.ok(blk(lowPlan) <= 45, `PLAN 低时单块应 ≤45 分钟，实际 ${blk(lowPlan)}`);
  assert.ok(blk(highPlan) > blk(lowPlan), 'PLAN 高应允许更长单块');
});

test('自习偏好映射到校园 POI（library → 图书馆）', () => {
  const { plan } = buildPhases(schedule, persona({ scenarios: { study_place: 'library' } }));
  const policy = plan.phases[0].policy;
  assert.ok(policy.studyPlaces.some((s) => s.includes('图书馆')),
    `应含图书馆，实际 ${JSON.stringify(policy.studyPlaces)}`);
});

test('自习偏好 = 宿舍时地点跟着变（不是写死图书馆）', () => {
  const { plan } = buildPhases(schedule, persona({ scenarios: { study_place: 'dorm' } }));
  const policy = plan.phases[0].policy;
  assert.ok(policy.studyPlaces.some((s) => s.includes('公寓')),
    `应含公寓，实际 ${JSON.stringify(policy.studyPlaces)}`);
});

test('没有画像也能生成合法规划，并在 reasons 里说明原因', () => {
  const { plan } = buildPhases(schedule, null);
  assertContiguous(plan);
  const first = plan.phases[0];
  assert.ok(first.reasons.some((r) => r.includes('画像')), '应说明还未做画像');
  assert.deepEqual(first.policy.studyPlaces.length > 0, true, '应有默认自习地点，不能为空');
});

test('每个阶段都给出 reasons（不黑箱）', () => {
  const { plan } = buildPhases(schedule, persona());
  for (const p of plan.phases) {
    assert.ok(p.reasons.length > 0, `阶段 ${p.kind} 缺少 reasons`);
  }
});

test('短学期（totalWeeks 很小）不会产生重叠或空洞', () => {
  const tiny = { ...schedule, totalWeeks: 2, courses: [] };
  const { plan } = buildPhases(tiny, persona());
  assertContiguous(plan);
});

test('adaptive：探索度高 / 随性而动 → 适应期更长', () => {
  const plain = buildPhases(schedule, persona()).plan;
  const explorer = buildPhases(schedule, persona({ axes: { EXP: 90 }, scenarios: { planning: 'flexible' } })).plan;
  const adaptLen = (p) => p.phases.find((x) => x.kind === 'adapt').toWeek;
  assert.ok(adaptLen(explorer) >= adaptLen(plain),
    `适应期应不短于默认（explorer=${adaptLen(explorer)}, plain=${adaptLen(plain)}）`);
});

test('buildPhasesFromCalendar 能从校历 phases 里取边界', () => {
  const calendar = { phases: [
    { kind: 'short', fromWeek: 1, toWeek: 2 },
    { kind: 'theory', fromWeek: 3, toWeek: 18 },
    { kind: 'exam', fromWeek: 19, toWeek: 20 },
  ] };
  const { plan } = buildPhasesFromCalendar(schedule, persona(), calendar);
  const exam = plan.phases.find((p) => p.kind === 'exam');
  assert.equal(exam.fromWeek, 19);
  assertContiguous(plan);
});

test('phaseOfWeek 能定位任意一周', () => {
  const { plan } = buildPhases(schedule, persona(), { theoryFromWeek: 3, examFromWeek: 19 });
  assert.equal(phaseOfWeek(plan, 1).kind, 'adapt');
  assert.equal(phaseOfWeek(plan, 19).kind, 'exam');
  assert.equal(phaseOfWeek(plan, 20).kind, 'exam');
  assert.equal(phaseOfWeek(plan, 99), undefined, '越界周应返回 undefined');
});
