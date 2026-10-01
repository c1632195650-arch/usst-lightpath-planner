/**
 * buildPhases 的阶段规划测试。
 * 跑法：npm run test:ui（node --test scripts/，Node 24 直接跑 TS）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhases, buildPhasesFromCalendar, phaseOfWeek,
} from '../src/lib/planner/buildPhases.ts';

// P1 系列锁的是「轴映射」这一层的逐点行为；知识钳制（E1，G 批起缺省全开）是
// 正交层、有自己的 wiring 测试（tests/knowledge-wiring.test.ts）。此处显式关掉，
// 避免缺省开关变化误伤本层锁 —— 2026-10-02 delta 融合（beta-v2 G2 并入）时发现。
process.env.KNOWLEDGE_WIRED = '0';

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

/* ============================================================
 * P1（2026-09-27）：轴 → 策略 改成**连续映射**
 * ------------------------------------------------------------
 * 这一组是「改动不许变坏」的守门人：
 *   ① 两个旧平台（≤35 / ≥70）必须与旧版**逐点一致** —— 原本已生效的人不能被削弱；
 *   ② 全 50 = 中性（不许有莫名偏移）；
 *   ③ 中段（35–70）必须真的动起来 —— 这正是本次改动的目的；
 *   ④ 单调 + 连续（不许把旧悬崖换成新悬崖）。
 * ========================================================== */

/** 旧版二元跳变（本次改动前的实现）—— 作为「不许被削弱」的参照物 */
const legacy = {
  ACH: (v, base) => (v >= 70 ? base * 1.2 : v <= 35 ? base * 0.8 : base),
  PLAN: (v, base) => (v >= 70 ? base + 30 : v <= 35 ? Math.min(base, 45) : base),
  HEA: (v, base) => (v <= 35 ? Math.min(0.6, base + 0.1) : v >= 70 ? Math.max(0.1, base - 0.05) : base),
};

/** 取某阶段 kind 的策略；不存在则返回 undefined */
const policyOfKind = (plan, kind) => plan.phases.find((p) => p.kind === kind)?.policy;

/** 全轴 50 的画像 = 中性；此时 applyPersona 应逐项等于基准策略 */
const neutralPlan = buildPhases(schedule, persona()).plan;

test('P1①：轴落在旧阈值平台上（≤35 / ≥70）时，策略与旧版【逐点一致】', () => {
  const kinds = ['adapt', 'normal', 'midterm', 'sprint', 'exam'];
  let checked = 0;
  for (const kind of kinds) {
    const base = policyOfKind(neutralPlan, kind);
    assert.ok(base, `中性计划里应存在 ${kind} 阶段`);
    for (let v = 0; v <= 100; v += 5) {
      if (v > 35 && v < 70) continue; // 中段是**有意**改动的区间，不在此断言范围
      const plan = buildPhases(schedule, persona({ axes: { ACH: v, PLAN: v, HEA: v } })).plan;
      const got = policyOfKind(plan, kind);
      assert.ok(got, `ACH/PLAN/HEA=${v} 时 ${kind} 阶段消失了 —— 阶段切分不该被这三条轴影响`);
      assert.equal(got.dailyStudyMin, Math.round(legacy.ACH(v, base.dailyStudyMin)),
        `ACH=${v} @${kind}：dailyStudyMin 偏离旧版`);
      assert.equal(got.maxBlockMin, legacy.PLAN(v, base.maxBlockMin),
        `PLAN=${v} @${kind}：maxBlockMin 偏离旧版`);
      assert.ok(Math.abs(got.blankRatio - legacy.HEA(v, base.blankRatio)) < 1e-9,
        `HEA=${v} @${kind}：blankRatio 偏离旧版（${got.blankRatio} vs ${legacy.HEA(v, base.blankRatio)}）`);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `应覆盖足够多的平台点，实际只检查了 ${checked} 组`);
});

test('P1②：全轴 50 = 中性，策略与基准逐项相等（不留偏移）', () => {
  const explicit50 = buildPhases(
    schedule,
    persona({ axes: { ACH: 50, PLAN: 50, HEA: 50, RES: 50, EXP: 50, SOC: 50 } }),
  ).plan;
  for (const kind of ['adapt', 'normal', 'midterm', 'sprint', 'exam']) {
    const a = policyOfKind(neutralPlan, kind);
    const b = policyOfKind(explicit50, kind);
    assert.ok(a && b, `${kind} 阶段应存在`);
    assert.equal(b.dailyStudyMin, a.dailyStudyMin, `${kind}：50 不应改动每日时长`);
    assert.equal(b.maxBlockMin, a.maxBlockMin, `${kind}：50 不应改动单块上限`);
    assert.ok(Math.abs(b.blankRatio - a.blankRatio) < 1e-9, `${kind}：50 不应改动留白`);
  }
});

test('P1③：中段（35–70）不再是无感死区', () => {
  const dailyAt = (v) => policyOfKind(buildPhases(schedule, persona({ axes: { ACH: v } })).plan, 'normal').dailyStudyMin;
  const blankAt = (v) => policyOfKind(buildPhases(schedule, persona({ axes: { HEA: v } })).plan, 'normal').blankRatio;

  // 旧版：36 与 69 都等于基准 120 —— 现在必须分别低于/高于基准
  assert.ok(dailyAt(40) < dailyAt(50), `ACH=40 应低于中性（实得 ${dailyAt(40)} vs ${dailyAt(50)}）`);
  assert.ok(dailyAt(60) > dailyAt(50), `ACH=60 应高于中性（实得 ${dailyAt(60)} vs ${dailyAt(50)}）`);
  assert.notEqual(dailyAt(60), dailyAt(65), '相邻中段取值也应能区分');
  assert.ok(blankAt(40) > blankAt(50), 'HEA=40 留白应多于中性');
  assert.ok(blankAt(60) < blankAt(50), 'HEA=60 留白应少于中性');
});

test('P1④：单调 + 连续（不许把旧悬崖换成新悬崖）', () => {
  const dailyAt = (v) => policyOfKind(buildPhases(schedule, persona({ axes: { ACH: v } })).plan, 'normal').dailyStudyMin;
  const blockAt = (v) => policyOfKind(buildPhases(schedule, persona({ axes: { PLAN: v } })).plan, 'normal').maxBlockMin;
  const blankAt = (v) => policyOfKind(buildPhases(schedule, persona({ axes: { HEA: v } })).plan, 'normal').blankRatio;

  // 单调性
  for (let v = 0; v < 100; v++) {
    assert.ok(dailyAt(v) <= dailyAt(v + 1), `dailyStudyMin 在 ACH=${v} 处非单调`);
    assert.ok(blockAt(v) <= blockAt(v + 1), `maxBlockMin 在 PLAN=${v} 处非单调`);
    assert.ok(blankAt(v) >= blankAt(v + 1) - 1e-9, `blankRatio 在 HEA=${v} 处非单调`);
  }

  // 连续性：相邻整数点的跳跃不超过全程幅度的 1/10
  const jumpOk = (fn, lo, hi, label) => {
    const span = Math.abs(fn(100) - fn(0));
    const cap = span / 10 + 1e-9;
    for (let v = 0; v < 100; v++) {
      assert.ok(Math.abs(fn(v + 1) - fn(v)) <= cap,
        `${label} 在 ${v}→${v + 1} 处跳跃过大（>${cap.toFixed(4)}）`);
    }
  };
  jumpOk(dailyAt, 60, 240, 'dailyStudyMin');
  jumpOk(blockAt, 30, 150, 'maxBlockMin');
  jumpOk(blankAt, 0.1, 0.6, 'blankRatio');
});
