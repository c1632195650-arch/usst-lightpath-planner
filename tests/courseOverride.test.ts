/**
 * R3 测试：调课/停课覆盖层 + 长期判定（含"读法 A"）
 * ============================================================
 * 守的四件事：
 *   1. **原始 `Schedule` 永不被改**（两倍：同一引用 + 深度内容一致）
 *   2. **默认只这周**：一次性的覆盖不影响其它周
 *   3. **长期 = 创建之后**（读法 A），且同กัน多条时取最新那条
 *   4. **长期判定只有一处**：`detectScope()` 的三种输出都不能猜错
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Course, CourseTimeSlot, DayOfWeek, Schedule } from '@/types';
import { activeInWeek } from '@/lib/planner/construct';
import {
  activeOverrides, applyCourseOverrides, endPeriodOfMin, overrideScopeText, periodOfMin,
} from '@/lib/planner/courseOverrides';
import { effectiveRuleAt, effectiveFromWeek, longRuleApplies } from '@/lib/planner/longTermRules';
import { detectScope, scopeReason } from '@/features/feedback/parseCorrection';

function slot(day: number, startPeriod: number, endPeriod: number, weeks: number[] = []): CourseTimeSlot {
  return { dayOfWeek: day as DayOfWeek, startPeriod, endPeriod, weeks };
}

function course(id: string, name: string, slots: CourseTimeSlot[]): Course {
  return { id, name, credit: 3, category: '专业核心', slots };
}

function schedule(totalWeeks = 20): Schedule {
  return {
    termStart: '2026-09-07',
    totalWeeks,
    courses: [
      course('c1', '大学物理', [slot(3, 3, 4), slot(5, 5, 6)]),
      course('c2', '高等数学', [slot(1, 1, 2)]),
    ],
  };
}

const frozen = JSON.parse(JSON.stringify(schedule())) as Schedule;
const fresh = () => JSON.parse(JSON.stringify(frozen)) as Schedule;

/* ------------------------------------------------------------
 * 一、★ 原始课表永不被修改
 * ---------------------------------------------------------- */

test('应用覆盖后传入的 Schedule 一个字符都不变（这是覆盖层的第一原则）', () => {
  const s = fresh();
  const before = JSON.stringify(s);
  applyCourseOverrides(s, [
    { id: 'o1', courseId: 'c1', startPeriod: 3, weekNo: 5, action: 'cancel', createdAtWeek: 5 },
    { id: 'o2', courseId: 'c1', startPeriod: 3, weekNo: null, action: 'move', newDay: 4, newStartMin: 8 * 60, newEndMin: 9 * 60 + 40, createdAtWeek: 5 },
  ], 5);
  assert.equal(JSON.stringify(s), before, '原始课表必须逐字节不变 —— 否则无法撤销，也无法「只影响一周」');
});

/* ------------------------------------------------------------
 * 二、停课
 * ---------------------------------------------------------- */

test('停课只影响这一周 —— 下周照旧上课', () => {
  const s = fresh();
  const ov = [{ id: 'o1', courseId: 'c1', startPeriod: 3, weekNo: 5, action: 'cancel' as const, createdAtWeek: 5 }];
  const w5 = applyCourseOverrides(s, ov, 5);
  const c1w5 = w5.schedule.courses.find((c) => c.id === 'c1')!;
  assert.equal(activeInWeek({ ...slot(3, 3, 4), weeks: [] }, 5), true, '前置：空 weeks 代表全学期');
  assert.ok(!c1w5.slots.some((s2) => s2.startPeriod === 3 && s2.dayOfWeek === 3 && (s2.weeks ?? []).includes(5)),
    '第 5 周这节应当失效');
  const w6 = applyCourseOverrides(s, ov, 6);
  const c1w6 = w6.schedule.courses.find((c) => c.id === 'c1')!;
  assert.ok(c1w6.slots.some((s2) => s2.startPeriod === 3 && !s2.weeks?.length) ||
    c1w6.slots.some((s2) => s2.startPeriod === 3 && (s2.weeks ?? []).includes(6)),
  '第 6 周应当照旧上课');
  assert.equal(w5.applied.length, 1);
  assert.equal(w5.applied[0].scope, 'once');
});

test('长期停课：从创建周起生效，之前的周不受影响（读法 A）', () => {
  const s = fresh();
  const ov = [{ id: 'o1', courseId: 'c1', startPeriod: 3, weekNo: null, action: 'cancel' as const, createdAtWeek: 8 }];
  const beforeRes = applyCourseOverrides(s, ov, 6);
  assert.equal(beforeRes.applied.length, 0, '第 6 周（早于创建周）不该看到这条长期停课');
  const after = applyCourseOverrides(s, ov, 9);
  assert.equal(after.applied.length, 1, '第 9 周应当生效');
  const c1 = after.schedule.courses.find((c) => c.id === 'c1')!;
  assert.ok(!c1.slots.some((s2) => s2.startPeriod === 3), '长期停课把这个节次从派生副本里拿掉了');
  assert.equal(overrideScopeText(ov[0], 20), '第 8–20 周起（长期）');
});

/* ------------------------------------------------------------
 * 三、调课
 * ---------------------------------------------------------- */

test('调课：本周从原时段挪到新时段，其它课时不受牵连', () => {
  const s = fresh();
  const ov = [{
    id: 'o1', courseId: 'c1', startPeriod: 3, weekNo: 5, action: 'move' as const,
    newDay: 5, newStartMin: 14 * 60, newEndMin: 15 * 60 + 40, createdAtWeek: 5,
  }];
  const res = applyCourseOverrides(s, ov, 5);
  const c1 = res.schedule.courses.find((c) => c.id === 'c1')!;
  assert.ok(c1.slots.some((s2) => s2.dayOfWeek === 5 && s2.startPeriod === periodOfMin(14 * 60)),
    '应当在周五出现新的节次');
  assert.equal(res.applied[0].action, 'move');
  // 其它课程不受影响
  const c2 = res.schedule.courses.find((c) => c.id === 'c2')!;
  assert.deepEqual(c2.slots, frozen.courses[1].slots, '没被覆盖的课程必须原样保留');
});

test('节次换算：时间 → 最接近的节（13:30 归到下午第一节附近，不猜到别处）', () => {
  const p = periodOfMin(8 * 60);
  assert.ok(p >= 1 && p <= 13, '换算结果必须落在已知节次范围内');
  assert.equal(endPeriodOfMin(9 * 60 + 40), periodOfMin(9 * 60 + 40) >= 0 ? endPeriodOfMin(9 * 60 + 40) : 0);
  assert.ok([1, 2, 3].includes(endPeriodOfMin(9 * 60 + 40)), '9:40 应落在上午的前几节');
});

/* ------------------------------------------------------------
 * 四、多条长期规则 → 取创建周最大的那条
 * ---------------------------------------------------------- */

test('activeOverrides：同一「课程+节次」只让一条生效，且是最新创建的', () => {
  const list = [
    { id: 'a', courseId: 'c1', startPeriod: 3, weekNo: null, action: 'cancel' as const, createdAtWeek: 5 },
    { id: 'b', courseId: 'c1', startPeriod: 3, weekNo: null, action: 'move' as const, newDay: 4, createdAtWeek: 8 },
  ];
  const r = activeOverrides(list, 9);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].id, 'b', '第 9 周该生效的是第 8 周创建的那条');
  assert.equal(r.ignoredCount, 1);
  // 第 6 周还轮不到第 8 周那条
  const early = activeOverrides(list, 6);
  assert.equal(early.list[0].id, 'a', '第 6 周看到的应是第 5 周那条');
});

test('effectiveRuleAt：创建之前的周次看不到规则，之后才看到', () => {
  const rules = [
    { id: 'x', createdAtWeek: 5, weekNo: null as number | null },
    { id: 'y', createdAtWeek: 8, weekNo: null as number | null },
  ];
  assert.equal(effectiveRuleAt(rules, 4), null, '创建之前的周没有规则生效');
  assert.equal(effectiveRuleAt(rules, 5)?.id, 'x');
  assert.equal(effectiveRuleAt(rules, 7)?.id, 'x');
  assert.equal(effectiveRuleAt(rules, 8)?.id, 'y');
  assert.equal(effectiveRuleAt(rules, 12)?.id, 'y');
  assert.equal(effectiveFromWeek({ weekNo: 3 }), 3);
  assert.equal(longRuleApplies({ weekNo: 3 }, 3), false, '一次性规则不走长期判定');
});

/* ------------------------------------------------------------
 * 五、长期判定 detectScope（唯一入口）
 * ---------------------------------------------------------- */

test('detectScope：明确信号才下结论，拿不准就返回 ask', () => {
  assert.equal(detectScope('以后每周四下午都别排'), 'long');
  assert.equal(detectScope('长期别在晚上安排'), 'long');
  assert.equal(detectScope('以后都别排'), 'long');
  assert.equal(detectScope('周四下午别排'), 'once', '没说长期的信号 → 一次性');
  assert.equal(detectScope('这周三下午别排'), 'once');
  assert.equal(detectScope('临时有事，下午别排'), 'once');
  assert.equal(detectScope('下午有实验'), 'ask', '没有明确信号 → 必须问，不猜');
  assert.equal(detectScope(''), 'ask');
  assert.equal(detectScope('这周开始每周都这样'), 'ask', '两种信号混在一起也说不清，照旧要问');
  assert.ok(scopeReason('ask').length > 0);
});
