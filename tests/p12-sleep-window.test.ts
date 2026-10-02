/**
 * P1-2 就寝日窗测试（白天批 2026-10-02，任务书 §三 P1-2）
 * ============================================================
 * 覆盖：
 *   ① dayWindowWithFallback 三分支：作息设置真源优先 / 问卷就寝兜底 / 双无 null
 *      + 退化守卫（就寝 ≤ 缺省起床 → null，不猜纠正值）
 *   ② 引擎消费：dayEnd=22:30 → 无软块跨 22:30；基线（不传）确实会排进 22:30-23:00
 *      ——「填了就寝时间日程照样排到深夜」的根修证明
 *   ③ 不传 → 引擎缺省 07:00/23:00，行为与既往逐位一致（golden 零漂移的本质）
 *
 * 反向验证：① 删 fallback 分支 → 兜底用例红；② 删 dayEnd 透传 → 引擎用例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dayWindowWithFallback, routineToDayWindow } from '../src/features/week/routineStore.ts';
import { solveWeek } from '../src/lib/planner/solver.ts';
import { toPlanRequest } from '../src/lib/planner/schedule.ts';
import { buildPhasesFromCalendar, phaseOfWeek } from '../src/lib/planner/buildPhases.ts';
import { TERM_CALENDAR } from '../src/constants/term.ts';
import type { Schedule } from '../src/types.ts';

const SCHEDULE: Schedule = {
  semesterName: 's', semesterType: 'autumn', termStart: '2026-09-07',
  totalWeeks: 20, source: 'demo', courses: [],
};
const policy = phaseOfWeek(buildPhasesFromCalendar(SCHEDULE, null, TERM_CALENDAR['2026-2027-1']).plan, 3)!.policy;

test('P1-2① 日窗组合三分支 + 退化守卫（纯函数）', () => {
  // 作息设置是真源：起床+就寝都生效
  assert.deepEqual(
    dayWindowWithFallback({ wakeMin: 420, sleepMin: 1350 }, 1380),
    { dayStart: '07:00', dayEnd: '22:30' },
    '作息设置在场时问卷值不得覆盖（唯一真源）',
  );
  assert.deepEqual(
    routineToDayWindow({ wakeMin: 420, sleepMin: 1350 }),
    { dayStart: '07:00', dayEnd: '22:30' },
  );
  // 作息未采集 → 问卷就寝兜底（dayStart 保持缺省 07:00，起床不猜）
  assert.deepEqual(dayWindowWithFallback(null, 1380), { dayStart: '07:00', dayEnd: '23:00' });
  // 反向验证锚：删掉 dayWindowWithFallback 的兜底分支 → 本断言红
  assert.deepEqual(dayWindowWithFallback(undefined, 1350), { dayStart: '07:00', dayEnd: '22:30' });
  // 双无 → null
  assert.equal(dayWindowWithFallback(null, null), null);
  assert.equal(dayWindowWithFallback(null, undefined), null);
  // 退化守卫：就寝 ≤ 缺省起床（420）→ null（引擎排不出任何软块的坏数据，不猜）
  assert.equal(dayWindowWithFallback(null, 300), null);
  assert.equal(dayWindowWithFallback(null, 420), null);
});

test('P1-2② 引擎消费：dayEnd=22:30 无软块跨线；基线确实会排进 22:30-23:00', () => {
  // 夹具：晚课政策 + 大自习目标（实测需 dailyStudyMin 900 / blank 0.05 才填满到 23:00）
  const nightPolicy = { ...policy, eveningAllowed: true, dailyStudyMin: 900, blankRatio: 0.05 };
  const base = solveWeek(toPlanRequest({
    schedule: SCHEDULE, weekNo: 3, policy: nightPolicy, dayEnd: '23:00',
  }));
  const lateBlocks = (plan: typeof base.plan, endMin: number) =>
    plan.blocks.filter((b) => b.kind !== 'course' && b.endMin > endMin);
  // 基线锚：不传就寝时，软块确实会越过 22:30（否则本测试空转）
  const baseLate = lateBlocks(base.plan, 22 * 60 + 30);
  assert.ok(baseLate.length > 0, `夹具应有跨 22:30 的软块（实际 ${baseLate.length} 个）——没有则本用例失去判别力`);

  // 传就寝 22:30 → 任何非课程软块都不得越过
  const early = solveWeek(toPlanRequest({
    schedule: SCHEDULE, weekNo: 3, policy: nightPolicy, dayEnd: '22:30',
  }));
  const earlyLate = lateBlocks(early.plan, 22 * 60 + 30);
  assert.equal(earlyLate.length, 0, `dayEnd=22:30 后不应有软块跨线（实际 ${earlyLate.length} 个：${earlyLate.slice(0, 3).map((b) => b.title).join(',')}）`);
});

test('P1-2③ 不传 dayStart/dayEnd → 与缺省行为逐位一致（golden 零漂移的本质）', () => {
  const nightPolicy = { ...policy, eveningAllowed: true, dailyStudyMin: 900, blankRatio: 0.05 };
  const omitted = solveWeek(toPlanRequest({ schedule: SCHEDULE, weekNo: 3, policy: nightPolicy }));
  const explicit = solveWeek(toPlanRequest({ schedule: SCHEDULE, weekNo: 3, policy: nightPolicy, dayStart: '07:00', dayEnd: '23:00' }));
  assert.deepEqual(
    omitted.plan.blocks.map((b) => [b.id, b.startMin, b.endMin]),
    explicit.plan.blocks.map((b) => [b.id, b.startMin, b.endMin]),
    '不传日窗 = 引擎缺省 07:00/23:00（组合层 null → 不传键）',
  );
});
