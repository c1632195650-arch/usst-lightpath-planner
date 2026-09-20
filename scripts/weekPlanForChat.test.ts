/**
 * 梨宝对话路径的周计划：必须与周计划页**同源**（2026-09-20）
 * ============================================================
 * 背景（本次复核发现）：`planWeekForChat` 此前只往 `toPlanRequest` 传
 * `{schedule, weekNo, policy, scenarios}` —— **不传 `tasks`**。
 * 于是对话里那份周计划比周计划页少了**整类**块：
 *   · 校历事件准备块（光电杯材料 / 四六级真题，来自 `expandDeadlines`）
 *   · 课程备考块（来自 `expandExamPrep`，本次新增）
 * 用户连着看两处就会发现对不上 —— 正是 `weekPlanForChat.ts` 文件头自己警告的
 * 「双轨破绽」（旧模板那套已删，这次是漏传 tasks 造成的**第二处**同类问题）。
 *
 * 反向验证（纪律）：把 `weekPlanForChat.ts` 里 `base` 的 `tasks,` 去掉
 *   → 本文件第一条必红。已实测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planWeekForChat } from '../src/features/libao/weekPlanForChat.ts';
import { expandExamPrep } from '../src/lib/planner/events.ts';

const TERM_START = '2026-09-07';
const TOTAL_WEEKS = 20;
/** 2026-10-26 是第 8 周周一（学期内），确保备考窗口落在有效周次里 */
const EXAM_DATE = '2026-10-26';

const SCHEDULE = {
  semesterName: '2026-2027-1', semesterType: 'autumn' as const,
  termStart: TERM_START, totalWeeks: TOTAL_WEEKS, source: 'manual' as const,
  courses: [{
    id: 'c1', name: '大学物理A(2)', credit: 4, category: '公共基础' as const,
    campus: 'JG516' as const, building: '第一教学楼', room: '144',
    slots: [{ dayOfWeek: 1 as const, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3, 4, 5, 6, 7, 8] }],
    examDate: EXAM_DATE,
  }],
};

test('对话路径的周计划含课程备考块（与周计划页同源）', async () => {
  const tasks = expandExamPrep(SCHEDULE.courses, TERM_START, TOTAL_WEEKS);
  assert.ok(tasks.length > 0, '夹具应能展开出备考任务');
  const weekNo = tasks[0].weeks![0];

  const plan = await planWeekForChat(SCHEDULE, null, weekNo);
  assert.ok(plan, `第 ${weekNo} 周应排得出计划`);
  const prep = plan.blocks.filter((b) => b.title.includes('备考'));
  assert.ok(
    prep.length > 0,
    `第 ${weekNo} 周对话计划应含备考块 —— 实际块：${plan.blocks.map((b) => b.title).join(' / ')}`,
  );
  assert.equal(prep[0].fromEventId, 'exam-c1', '备考块应能溯源到课程考试（同一条 UserTask 通道）');
});

test('反向对照：课程没有 examDate 时，同一条路径不出备考块', async () => {
  const tasks = expandExamPrep(SCHEDULE.courses, TERM_START, TOTAL_WEEKS);
  const weekNo = tasks[0].weeks![0];
  const noExam = {
    ...SCHEDULE,
    courses: SCHEDULE.courses.map(({ examDate: _drop, ...rest }) => rest),
  };

  const plan = await planWeekForChat(noExam, null, weekNo);
  assert.ok(plan);
  assert.equal(plan.blocks.filter((b) => b.title.includes('备考')).length, 0,
    '没有考试日就不该编造备考块（差异必须来自数据，不是文案）');
});
