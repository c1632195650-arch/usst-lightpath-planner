/*
 * 运动恢复带的回归守卫（2026-10-07）
 * ============================================================
 * 背景：construct.ts 的「运动后恢复带」（RECOVERY_AFTER_SPORT_MIN）原实现在
 * `placeTemplate` / `fillStudy` 两处**无条件**把落点抬到 `recoveryUntil` ——
 * 于是「运动之前」的空档（早晨/午间）也被抬出界：运动一排上，那些空档就装不下
 * 任何自习/午休/夜宵（由 scripts/scheduler.test.ts 的 98/103 抓到本次回归）。
 *
 * 修复：恢复带只在「空档整体位于运动之后」（gap.startMin >= 运动结束时刻）时生效。
 *
 * 本文件只守这一条：自驱型画像下运动排上后，**运动之前的空档仍能被自习使用**。
 * 跑法：node --import ./scripts/register-alias.mjs --test tests/sportRecovery.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWeekPlan } from '../src/lib/planner/schedule.ts';

/* ---------------- 夹具：与 scripts/scheduler.test.ts 同口径 ---------------- */

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
function slot(dayOfWeek, startPeriod, endPeriod, weeks) {
  return { dayOfWeek, startPeriod, endPeriod, weeks };
}
function course(id, name, building, campus, slots, category = '公共基础', room) {
  return { id, name, credit: 2, category, campus, building, slots, room };
}

const schedule = {
  semesterName: '2026-2027-1', semesterType: 'autumn',
  termStart: '2026-09-07', totalWeeks: 20, source: 'demo',
  courses: [
    course('c1', '大学物理A(2)', '第一教学楼', 'JG516',
      [slot(1, 1, 2, range(3, 18)), slot(4, 6, 7, range(3, 18))], '公共基础', '144'),
    course('c2', '概率论与数理统计B', '第三教学楼', 'JG516', [slot(1, 3, 5, range(3, 18))]),
    course('c3', '金工实习', '综合楼', 'JG516', [slot(3, 6, 9, range(6, 9))], '实践环节'),
    course('c4', '篮球', undefined, 'JG516', [slot(2, 3, 5, range(3, 18))], '通识选修'),
    course('c5', '模拟电子技术实验', '国合楼', 'JG334', [slot(5, 6, 7, range(10, 18))], '实践环节'),
  ],
};

const policy = {
  dailyStudyMin: 120, maxBlockMin: 60, blankRatio: 0.25,
  eveningAllowed: false, weekendWork: false,
  studyPlaces: ['图书馆（图文信息中心）'],
};
const scen = {
  meal_radius: 'near', planning: 'planned', event_breadth: 'narrow', social_radius: 'close',
  night_supply: 'convenience', exercise_trigger: 'self_plan', study_place: 'library',
  info_channel: 'self_search',
};

const PLAN = buildWeekPlan({
  schedule, weekNo: 4, policy, scenarios: scen, transfer: () => null,
}).plan;

/* ---------------- 回归守卫 ---------------- */

test('运动排上后，运动之前的空档仍能被自习使用（恢复带不得误伤）', () => {
  const sports = PLAN.blocks.filter((b) => /运动场|体育馆/.test(b.place ?? ''));
  assert.ok(sports.length > 0, '前置条件：自驱型画像应排出运动块');

  // 「运动之前」= 同一天、结束时刻早于运动起点。
  // 修复前：所有空档的落点都被 recoveryUntil 抬起 → 运动前的时段一律无自习 → 本断言失败。
  const anyBefore = sports.some((s) =>
    PLAN.blocks.some(
      (b) => b.dayOfWeek === s.dayOfWeek && b.kind === 'study' && b.endMin <= s.startMin,
    ),
  );
  assert.ok(
    anyBefore,
    '至少应有一天的运动块之前仍放着自习 —— 若失败，说明恢复带又误伤了运动前的空档',
  );
});
