/**
 * 跨周滚动的沉淀 —— 应用层验收
 * 跑法：npm run test:ui
 *
 * 这一组盯的是**「负荷来源 = 实际优先、计划兜底」这条已确认的决定，落地成了什么行为**，
 * 以及两条必须防住的失效：
 *   ① **自指正反馈** —— 本周自己排出来的负荷若立刻回头影响本周的排法，
 *      就会出现「排得满 → 以为你累 → 排得更空 → 更以为你累」；
 *   ② **自我叠加** —— 同一周里用户会反复标记（每标一次重算一次），
 *      若拿自己的上一次输出当基线，点两次「没做」负荷就被算两遍。
 *      `rollingBaseFor()` 保证本周内任意次重算都从同一个起点出发。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { BehaviorRecord } from '@/features/behavior/behaviorLog';
import { makeId } from '@/features/behavior/behaviorLog';
import {
  isSettledWeek, mergeWeekRolling, rollingBaseFor, rollingForPlan, rollingSummary,
  withWeekRolling,
} from '@/features/plan/rollingState.ts';
import { emptyPlanState } from '@/features/plan/planLock.ts';
import { FATIGUE } from '@/lib/planner/fatigue.ts';
import { solveWeek } from '@/lib/planner/solver.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { mondayOfWeekNo, weekDates } from '@/lib/date';
import type { PlanPersistState, RollingState, WeekPlan } from '@/types';
import { buildGoldenInput, goldenInputByName } from '../tests/golden-inputs.ts';

const G = goldenInputByName('week-04-typical');
if (!G) throw new Error('缺少 golden 语料 week-04-typical');
const BASE = toPlanRequest(buildGoldenInput(G));

/** 夹具周（周一）与那一周七天的日期 */
const DATES = weekDates(mondayOfWeekNo(BASE.schedule.termStart, 4));

/** 引擎产出的原始滚动状态：loadByDow 下标 1..7 = 周一到周日 */
function engineRolling(byDow: number[]): RollingState {
  return { recentLoad: byDow.slice(1), loadByDow: byDow, upcoming: [] };
}

/** 一份「上周的」滚动基线 */
function baseline(recent: number, feasibleByDow?: number[]): RollingState {
  return {
    recentLoad: Array.from({ length: 7 }, () => recent),
    loadByDow: [0, 0, 0, 0, 0, 0, 0, 0],
    upcoming: [],
    ...(feasibleByDow ? { feasibleByDow } : {}),
  };
}

/** 一条行为记录 */
function rec(blockId: string, date: string, status: 'done' | 'skipped', plannedMin: number): BehaviorRecord {
  return {
    id: makeId(blockId, date), blockId, date, weekNo: 4, kind: 'study',
    title: '自习', plannedMin, status, at: `${date}T21:00:00`,
  };
}

function studyMinOf(plan: WeekPlan, day?: number): number {
  return plan.blocks
    .filter((b) => b.kind === 'study' && (day == null || b.dayOfWeek === day))
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
}

/* ============================================================
 * 一、「实际优先、计划兜底」—— 以及「没做」与「没数据」的区别
 * ========================================================== */

test('有反馈的那天用实际值，没反馈的那天退回计划值', () => {
  const res = mergeWeekRolling({
    engine: engineRolling([0, 400, 400, 400, 400, 400, 0, 0]),
    base: null,
    records: [
      rec('b-mon', DATES[0], 'done', 90),
      rec('b-tue', DATES[1], 'skipped', 60),
    ],
    weekDates: DATES,
    weekNo: 4,
  });

  assert.equal(res.rolling.recentLoad[0], 90, '周一做了 90 分钟 → 用实际 90，而不是计划 400');
  assert.equal(res.feedbackDays, 2);
  assert.equal(res.rolling.throughWeek, 4, '必须记下知识截止周，否则挡不住自指');
});

test('「没做」记 0，「没数据」退回计划值 —— 两者绝不能混为一谈', () => {
  const res = mergeWeekRolling({
    engine: engineRolling([0, 400, 400, 400, 0, 0, 0, 0]),
    base: null,
    records: [
      rec('b-tue', DATES[1], 'skipped', 60), // 有反馈，且明确没做
    ],
    weekDates: DATES,
    weekNo: 4,
  });

  assert.equal(
    res.rolling.recentLoad[1], 0,
    '周二有「没做」的反馈 → 负荷就是 0（这一天真的什么都没发生）',
  );
  assert.equal(
    res.rolling.recentLoad[2], 400,
    '周三没有任何反馈 → 退回计划值。记 0 会让引擎误以为你闲着，进而给你加量',
  );
});

test('完成率按计划时长加权，且没有反馈时是 null 而不是 0', () => {
  const engine = engineRolling([0, 400, 0, 0, 0, 0, 0, 0]);
  const withFeedback = mergeWeekRolling({
    engine,
    base: null,
    records: [rec('a', DATES[0], 'done', 90), rec('b', DATES[0], 'skipped', 30)],
    weekDates: DATES,
    weekNo: 4,
  });
  assert.equal(withFeedback.doneRate, 0.75, '90/(90+30) = 0.75');

  const none = mergeWeekRolling({ engine, base: null, records: [], weekDates: DATES, weekNo: 4 });
  assert.equal(none.doneRate, null, '没有反馈 → null（0 会被读成「一个都没做」）');
  assert.equal(none.feedbackDays, 0);
  assert.equal(rollingSummary(none), null, '没有真实数据就不该编一句话出来');
  assert.match(
    rollingSummary(withFeedback) ?? '', /实际完成/,
    '有数据时给出可展示的一句话',
  );
});

/* ============================================================
 * 二、跨周累积（EWMA）与幂等
 * ========================================================== */

test('EWMA 跨周累积：单周变化不会一次吃满，也不会被立刻忘掉', () => {
  const res = mergeWeekRolling({
    engine: engineRolling([0, 300, 300, 300, 300, 300, 300, 300]),
    base: baseline(600),
    records: [],
    weekDates: DATES,
    weekNo: 5,
  });

  // 0.5 × 300（本周计划）+ 0.5 × 600（历史）= 450
  for (let i = 0; i < 7; i += 1) {
    assert.equal(res.rolling.recentLoad[i], 450, `下标 ${i} 应做 EWMA`);
  }
  assert.deepEqual(
    res.rolling.loadByDow, [0, 300, 300, 300, 300, 300, 300, 300],
    '原始计划负荷原样保留（它是自指量，只作诊断与兜底）',
  );
});

test('同一周反复重算幂等：基线不变，结果不变（否则点两次「没做」会算两遍）', () => {
  const engine = engineRolling([0, 400, 400, 400, 400, 400, 0, 0]);
  const records = [rec('a', DATES[0], 'done', 90)];
  const args = { engine, base: baseline(300), records, weekDates: DATES, weekNo: 4 };

  const first = mergeWeekRolling(args);
  const second = mergeWeekRolling(args);
  assert.deepEqual(second.rolling, first.rolling, '同输入两次沉淀必须得到同一份状态');

  // 若错误地拿「自己的输出」当基线，第二次就会变成 EWMA(90, 第一次的输出) —— 明显不同。
  // 这行断言就是本测试的区分度所在。
  const naive = mergeWeekRolling({ ...args, base: first.rolling });
  assert.notDeepEqual(naive.rolling, first.rolling, '拿自己的输出当基线会漂移 —— 所以必须存基线');
});

/* ============================================================
 * 三、逐日可行性
 * ========================================================== */

test('可行性 = 当天「做了」占「已标记」的比例；没反馈的天沿用历史值', () => {
  const res = mergeWeekRolling({
    engine: engineRolling([0, 300, 300, 300, 300, 300, 300, 300]),
    base: baseline(300, [0.7, 1, 1, 1, 1, 1, 1]),
    records: [
      rec('a', DATES[1], 'done', 150),    // 周二：做满
      rec('b', DATES[2], 'done', 120),
      rec('c', DATES[2], 'skipped', 30),  // 周三：120/150 → 0.8
      rec('d', DATES[3], 'skipped', 90),  // 周四：全没做 → 截断到下限
      rec('e', DATES[4], 'done', 30),
      rec('f', DATES[4], 'skipped', 90),  // 周五：30/120 = 0.25 → 同样截断
    ],
    weekDates: DATES,
    weekNo: 5,
  });
  const feas = res.rolling.feasibleByDow ?? [];
  assert.equal(feas[0], 0.7, '周一没反馈 → 沿用历史可行性，不重置为 1');
  assert.equal(feas[1], 1, '周二全做完 → 1');
  assert.equal(feas[2], 0.8, '周三 120/150 → 0.8（未触及下限）');
  assert.equal(feas[3], FATIGUE.minFeasible, '周四全跳过 → 截断到下限，而不是 0');
  assert.equal(
    feas[4], FATIGUE.minFeasible,
    '周五 30/120 也低于下限 → 同样截断。下限存在的意义：'
    + '可行性是「少排一点」不是「一天都不排」，否则会被读成「这天别安排任何事」',
  );
});

/* ============================================================
 * 四、自指防线与基线来源（本模块存在的首要理由）
 * ========================================================== */

test('本周自己沉淀出的状态，绝不能在排本周时被用上', () => {
  const base = emptyPlanState();
  const rolling: RollingState = {
    recentLoad: [500, 500, 500, 500, 500, 500, 500],
    loadByDow: [0, 0, 0, 0, 0, 0, 0, 0],
    upcoming: [],
    throughWeek: 4,
  };
  const state: PlanPersistState = { ...base, rolling };

  assert.equal(rollingForPlan(state, 4), undefined, '知识截止周 = 本周 → 不用（这就是自指）');
  assert.equal(rollingForPlan(state, 3), undefined, '未来的知识不能拿去排过去');
  assert.equal(rollingForPlan(state, 5), rolling, '截止第 4 周的知识可以用于第 5 周');

  const mindless: PlanPersistState = { ...base, rolling: { ...rolling, throughWeek: undefined } };
  assert.equal(rollingForPlan(mindless, 5), undefined, '来源不明的状态宁可不用');
  assert.equal(rollingForPlan(null, 5), undefined);
  assert.equal(rollingForPlan(undefined, 5), undefined);
});

test('本周内重算时回到「上周基线」，而不是回到自己上一次的输出', () => {
  const rollingBase = baseline(600);
  const state: PlanPersistState = {
    ...emptyPlanState(),
    rolling: { ...baseline(450), throughWeek: 4 },
    rollingBase,
  };
  assert.equal(rollingBaseFor(state, 4), rollingBase, '本周已沉淀过 → 回到基线重算');
  assert.equal(rollingBaseFor(state, 5), state.rolling, '进入下一周 → 直接用上一周的 rolling');

  const stale: PlanPersistState = { ...emptyPlanState(), rolling: { ...baseline(450), throughWeek: undefined } };
  assert.equal(rollingBaseFor(stale, 5), null, '来源不明 → 从零开始');
  assert.equal(rollingBaseFor(null, 5), null);
});

test('未来的周只消费、不沉淀（否则往后翻页会把目标一路拉低）', () => {
  assert.equal(isSettledWeek(4, 5), true, '已经过去的周 → 可以沉淀');
  assert.equal(isSettledWeek(5, 5), true, '正在进行的周 → 可以沉淀（这一周已经发生了）');
  assert.equal(isSettledWeek(6, 5), false, '未来的周还没发生 → 不许沉淀');
  assert.equal(isSettledWeek(30, 5), false);
});

/* ============================================================
 * 五、端到端验收
 * ========================================================== */

/** 连排三周：第 1 周排得很满（240 分/天、不留白、可用晚间），后面两周用同一策略 */
test('AC-3 连排三周：第 3 周自习总量低于第 1 周，且不会一路空下去', () => {
  const policy = { ...BASE.policy, dailyStudyMin: 240, blankRatio: 0, eveningAllowed: true };
  let state: PlanPersistState | null = null;
  const totals: number[] = [];

  for (const weekNo of [4, 5, 6]) {
    const base = rollingBaseFor(state, weekNo);
    const r = solveWeek({
      ...BASE, weekNo, policy, rolling: rollingForPlan(state, weekNo),
    } as never);
    totals.push(studyMinOf(r.plan));

    const merged = mergeWeekRolling({
      engine: r.nextRolling,
      base,
      records: [],
      weekDates: weekDates(mondayOfWeekNo(BASE.schedule.termStart, weekNo)),
      weekNo,
    });
    state = withWeekRolling(state, merged, base, weekNo);
  }

  assert.ok(totals[0] > 0, `夹具应排出自习，实际 ${totals.join(' / ')}`);
  assert.ok(
    totals[1] < totals[0],
    `负荷偏高，第 2 周自习该降下来：${totals.join(' → ')}`,
  );
  assert.ok(
    totals[2] < totals[0],
    `第 3 周仍应低于第 1 周：${totals.join(' → ')}`,
  );
  // 均值回复：自适应是「把你从过载里拉回来」，不是「一周比一周空」。
  // 没有这条，一个把目标无限压低的实现也能通过上面两条断言。
  assert.ok(
    totals[2] > totals[1],
    `负荷回落之后目标应该回来一点，不该继续探底：${totals.join(' → ')}`,
  );
});

test('AC-4 连续跳过某天的自习后，那天真的会少排', () => {
  const r0 = solveWeek({ ...BASE } as never);
  const wed = DATES[2];
  const skipped = r0.plan.blocks
    .filter((b) => b.dayOfWeek === 3 && b.kind === 'study')
    .map((b) => rec(b.id, wed, 'skipped', b.endMin - b.startMin));
  assert.ok(skipped.length > 0, '夹具周三应有自习块，否则本测试无从谈起');

  const merged = mergeWeekRolling({
    engine: r0.nextRolling, base: null, records: skipped, weekDates: DATES, weekNo: 4,
  });
  const state = withWeekRolling(null, merged, null, 4);

  const r1 = solveWeek({ ...BASE, weekNo: 5, rolling: rollingForPlan(state, 5) } as never);
  const before = studyMinOf(r0.plan, 3);
  const after = studyMinOf(r1.plan, 3);
  assert.ok(
    after < before,
    `周三的自习被连续跳过，第 5 周该少排：${before} → ${after}`,
  );
  for (const d of [1, 2, 4, 5]) {
    assert.equal(
      studyMinOf(r1.plan, d), studyMinOf(r0.plan, d),
      `周${d} 没被跳过，不该受影响`,
    );
  }
});
