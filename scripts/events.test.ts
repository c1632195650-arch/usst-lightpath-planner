/**
 * 校历事件展开测试（events）
 * 跑法：node --import tsx --test scripts/events.test.ts
 *
 * 覆盖「倒计时 → 日程里的准备块」这条转换——它是本轮的核心理念：
 * 事件不能只是旁边一个数字，它得真的改变日程。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expandDeadlines, expandExamPrep, eventsNearWeek, EXAM_PREP_DEFAULTS } from '../src/lib/planner/events.ts';
import { buildWeekPlan } from '../src/lib/planner/schedule.ts';
import { DEADLINES } from '../src/data/usst.ts';

const TERM_START = '2026-09-07';
const TOTAL_WEEKS = 20;

/** 极简课表：只有周一 1-2 节有课，其余大片空档 —— 方便验证准备块真的排得进去 */
const SCHEDULE = {
  semesterName: '2026-2027-1', semesterType: 'autumn' as const,
  termStart: TERM_START, totalWeeks: TOTAL_WEEKS, source: 'manual' as const,
  courses: [{
    id: 'c1', name: '大学物理A(2)', credit: 4, category: '公共基础' as const,
    campus: 'JG516' as const, building: '第一教学楼', room: '144',
    slots: [{ dayOfWeek: 1 as const, startPeriod: 1, endPeriod: 2, weeks: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] }],
  }],
};

const BASE_POLICY = {
  dailyStudyMin: 120, maxBlockMin: 60, blankRatio: 0.25,
  eveningAllowed: false, weekendWork: false,
  studyPlaces: ['图书馆（图文信息中心）'],
};

test('纯提醒类事件（没有 prep）不产生准备块', () => {
  const alertOnly = [{ id: 'x', date: '2026-10-01', title: '国庆假期', emoji: '🎉', tag: '假期', color: '#000' }];
  assert.equal(expandDeadlines(alertOnly, TERM_START, TOTAL_WEEKS).length, 0, '没有 prep 就不该排块');
});

test('光电杯截止 → 展开出准备块，且每块都落在截止日之前的窗口里', () => {
  const gdb = DEADLINES.find((d) => d.id === 'gdb');
  assert.ok(gdb?.prep, '光电杯应配了 prep');
  const prep = gdb.prep;

  const tasks = expandDeadlines([gdb], TERM_START, TOTAL_WEEKS);
  // 6 小时 ÷ 90 分钟 = 4 块
  assert.equal(tasks.length, Math.ceil((prep.prepHours * 60) / prep.blockMin));

  for (const t of tasks) {
    assert.equal(t.fromEventId, 'gdb', '每块都要能溯源到事件');
    assert.equal(t.essential, true, '有截止日期的块应标为硬需求');
    assert.equal(t.durationMin, prep.blockMin);
    assert.ok(
      (t.daysLeft ?? 0) > 0 && (t.daysLeft ?? 0) <= prep.leadDays,
      `daysLeft 应落在 1..${prep.leadDays}，实际 ${t.daysLeft}`,
    );
    assert.ok(t.weeks?.length === 1, '应精确到「哪一周」');
    assert.ok(t.dayOfWeek != null, '应精确到「星期几」—— 否则会变成一周里天天出现');
  }
});

test('展开是确定性的（同输入必得同输出）', () => {
  const a = expandDeadlines(DEADLINES, TERM_START, TOTAL_WEEKS);
  const b = expandDeadlines(DEADLINES, TERM_START, TOTAL_WEEKS);
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
  assert.deepEqual(a.map((t) => t.dayOfWeek), b.map((t) => t.dayOfWeek));
});

test('窗口落在学期之外时被剔除（不生成学期外的任务）', () => {
  const final = DEADLINES.find((d) => d.id === 'final');
  assert.ok(final);
  // 期末复习的窗口在第 18 周附近，把总周数压到 3 周就该一个都不剩
  assert.equal(expandDeadlines([final], TERM_START, 3).length, 0);
});

test('没有 termStart 时安全返回空（不抛错、不猜日期）', () => {
  assert.equal(expandDeadlines(DEADLINES, '', TOTAL_WEEKS).length, 0);
});

test('引擎消费事件任务：对应那周真的排出了「光电杯报名材料」准备块', () => {
  const tasks = expandDeadlines(DEADLINES, TERM_START, TOTAL_WEEKS);
  const gdbTasks = tasks.filter((t) => t.fromEventId === 'gdb');
  assert.ok(gdbTasks.length > 0, '光电杯应展开出任务');
  const weekNo = gdbTasks[0].weeks![0];

  const { plan } = buildWeekPlan({
    schedule: SCHEDULE, weekNo, policy: BASE_POLICY, tasks,
  });

  const prep = plan.blocks.filter((b) => b.fromEventId === 'gdb');
  assert.ok(
    prep.length > 0,
    `第 ${weekNo} 周应排出准备块，实际块：${plan.blocks.map((b) => b.title).join(' / ')}`,
  );
  assert.ok(prep.every((b) => b.title === '光电杯报名材料'), '块标题应来自 prep.taskTitle');
  assert.ok(prep.every((b) => b.source === 'user'), '事件块应标记为用户来源（区别于引擎自动排的）');
});

test('指定了星期几的浮动任务只在那一天出现（一周里不会天天冒出来）', () => {
  const tasks = expandDeadlines(DEADLINES, TERM_START, TOTAL_WEEKS);
  const weekNo = tasks.find((t) => t.fromEventId === 'gdb')!.weeks![0];
  const inWeek = tasks.filter((t) => t.fromEventId === 'gdb' && t.weeks![0] === weekNo);
  const wantedDays = new Set(inWeek.map((t) => t.dayOfWeek));

  const { plan } = buildWeekPlan({ schedule: SCHEDULE, weekNo, policy: BASE_POLICY, tasks });
  const prepDays = new Set(plan.blocks.filter((b) => b.fromEventId === 'gdb').map((b) => b.dayOfWeek));

  assert.ok(prepDays.size > 0, '应至少排上一天');
  for (const d of prepDays) {
    assert.ok(wantedDays.has(d), `第 ${d} 天不该出现光电杯准备块（它只该在 ${[...wantedDays].join('/')}）`);
  }
});

test('eventsNearWeek 返回本周与下周的事件（提示「为什么这周多出准备块」）', () => {
  const near = eventsNearWeek(DEADLINES, TERM_START, 3);
  // 第 3 周 = 09-21~09-27，第 4 周 = 09-28~10-04；光电杯在 09-28（第 4 周）
  assert.ok(near.some((d) => d.id === 'gdb'), '光电杯应落在「本周与下周」窗口内');
});

/* ============================================================
 * 课程考试日 → 备考块（expandExamPrep，2026-09-20）
 * ------------------------------------------------------------
 * 背景：`Course.examDate` 此前**全仓无人消费** —— 考试周不会自动出备考块。
 * 反向验证：把 `expandExamPrep` 的循环体注释掉 → 下面第一条必红。
 * ========================================================== */

/** 带考试日的课程（2026-10-26 = 第 8 周周一，落在学期内） */
const COURSE_WITH_EXAM = { ...SCHEDULE.courses[0], examDate: '2026-10-26' };

test('examDate 展开：块数 = ceil(prepHours×60/blockMin)，且每块可溯源、精确到周与星期', () => {
  const tasks = expandExamPrep([COURSE_WITH_EXAM], TERM_START, TOTAL_WEEKS);
  const want = Math.max(1, Math.ceil((EXAM_PREP_DEFAULTS.prepHours * 60) / EXAM_PREP_DEFAULTS.blockMin));
  assert.equal(tasks.length, want, `默认口径应出 ${want} 块`);
  for (const t of tasks) {
    assert.equal(t.fromEventId, `exam-${COURSE_WITH_EXAM.id}`, '每块都要能溯源到课程考试');
    assert.equal(t.title, `${COURSE_WITH_EXAM.name} 备考`);
    assert.equal(t.essential, true, '考试是硬交期 → 应标为硬需求');
    assert.equal(t.durationMin, EXAM_PREP_DEFAULTS.blockMin);
    assert.ok((t.daysLeft ?? 0) > 0 && (t.daysLeft ?? 0) <= EXAM_PREP_DEFAULTS.leadDays,
      `daysLeft 应落在 1..${EXAM_PREP_DEFAULTS.leadDays}，实际 ${t.daysLeft}`);
    assert.equal(t.weeks?.length, 1, '应精确到「哪一周」');
    assert.ok(t.dayOfWeek != null, '应精确到「星期几」');
    assert.match(t.id, /^ex-/, 'id 形状：ex-<courseId>-w<周>d<星期>');
  }
});

test('examDate 展开：没有考试日 / 学期外 / 没有 termStart 都不产生块（不猜）', () => {
  assert.equal(expandExamPrep([SCHEDULE.courses[0]], TERM_START, TOTAL_WEEKS).length, 0, '无 examDate');
  assert.equal(
    expandExamPrep([{ ...COURSE_WITH_EXAM, examDate: '2027-06-01' }], TERM_START, TOTAL_WEEKS).length, 0,
    '考试日远在学期外',
  );
  assert.equal(expandExamPrep([COURSE_WITH_EXAM], '', TOTAL_WEEKS).length, 0, '没有 termStart');
});

test('examDate 展开：口径由 options 决定，且是确定性的', () => {
  const opts = { leadDays: 6, blockMin: 90, prepHours: 3 };
  const a = expandExamPrep([COURSE_WITH_EXAM], TERM_START, TOTAL_WEEKS, opts);
  const b = expandExamPrep([COURSE_WITH_EXAM], TERM_START, TOTAL_WEEKS, opts);
  assert.equal(a.length, 2, '3h ÷ 90min = 2 块');
  assert.ok(a.every((t) => t.durationMin === 90));
  assert.ok(a.every((t) => (t.daysLeft ?? 0) <= 6), '窗口应收到 leadDays=6');
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id), '同输入必得同输出');
});

test('引擎消费备考任务：考试前那周真的排出了「备考」块', () => {
  const tasks = expandExamPrep([COURSE_WITH_EXAM], TERM_START, TOTAL_WEEKS);
  assert.ok(tasks.length > 0);
  const weekNo = tasks[0].weeks![0];

  const { plan } = buildWeekPlan({ schedule: SCHEDULE, weekNo, policy: BASE_POLICY, tasks });
  const prep = plan.blocks.filter((b) => b.fromEventId === `exam-${COURSE_WITH_EXAM.id}`);
  assert.ok(
    prep.length > 0,
    `第 ${weekNo} 周应排出备考块，实际块：${plan.blocks.map((b) => b.title).join(' / ')}`,
  );
  assert.ok(prep.every((b) => b.title === `${COURSE_WITH_EXAM.name} 备考`));
  assert.ok(prep.every((b) => b.source === 'user'), '备考块应标记为用户来源');
});
