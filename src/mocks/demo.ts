import type {
  Schedule, Course, UserProfile, Task, Phase, PhasePlan,
  WeekPlan, DayPlan, TimeBlock, ExamCountdown,
} from '@/types';
import { buildPhases } from '@/constants/phases';
import { PERIOD_START, PERIOD_END, toMinutes, toHHmm } from '@/constants/time';

/**
 * 演示数据（Demo only）
 *
 * 这些数据只用于「看界面 / 看流程」，不含真实后端、不解析真实 PDF。
 * 真实排程引擎（M4）上线后，本文件将被替换。
 */

/* ---------------- 课表 ---------------- */

export const DEMO_SCHEDULE: Schedule = {
  semesterName: '2026–2027 学年 第一学期',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 18,
  source: 'demo',
  courses: [
    {
      id: 'c1', name: '高等数学 A（下）', credit: 5, category: '公共基础',
      campus: 'JG516', building: '第一教学楼', room: '301',
      slots: [
        { dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [] },
        { dayOfWeek: 3, startPeriod: 1, endPeriod: 2, weeks: [] },
      ],
      examDate: '2027-01-11', mastery: 0.62, difficulty: 4,
    },
    {
      id: 'c2', name: '大学物理（光学）', credit: 4, category: '专业核心',
      campus: 'JG516', building: '第三教学楼', room: '102',
      slots: [{ dayOfWeek: 2, startPeriod: 3, endPeriod: 4, weeks: [] }],
      examDate: '2027-01-13', mastery: 0.5, difficulty: 4,
    },
    {
      id: 'c3', name: 'C 语言程序设计', credit: 3, category: '专业核心',
      campus: 'JG334', building: '实验楼', room: 'E203',
      slots: [{ dayOfWeek: 4, startPeriod: 5, endPeriod: 6, weeks: [] }],
      examDate: '2027-01-15', mastery: 0.7, difficulty: 3,
    },
    {
      id: 'c4', name: '大学英语（三）', credit: 2, category: '公共基础',
      campus: 'JG516', building: '外语楼', room: '508',
      slots: [{ dayOfWeek: 5, startPeriod: 1, endPeriod: 2, weeks: [1, 3, 5, 7, 9, 11, 13, 15] }],
      examDate: '2027-01-09', mastery: 0.66, difficulty: 2,
    },
    {
      id: 'c5', name: '电路与电子技术', credit: 4, category: '专业核心',
      campus: 'JG1100', building: '光电楼', room: 'A305',
      slots: [{ dayOfWeek: 3, startPeriod: 5, endPeriod: 6, weeks: [] }],
      examDate: '2027-01-16', mastery: 0.45, difficulty: 5,
    },
    {
      id: 'c6', name: '体育（篮球）', credit: 1, category: '通识选修',
      campus: 'JG516', building: '体育馆',
      slots: [{ dayOfWeek: 6, startPeriod: 3, endPeriod: 4, weeks: [] }],
      mastery: 0.9, difficulty: 1,
    },
  ],
};

/* ---------------- 画像 ---------------- */

export const DEMO_PROFILE: UserProfile = {
  version: 1,
  goal: 'postgrad',
  chronotype: 'night',
  weeklyStudyHours: 18,
  stressTolerance: 3,
  interests: ['篮球', '摄影', '吉他'],
  wakeTime: '08:30',
  sleepTime: '00:30',
  blankRate: 0.3,
  createdAt: '2026-09-07T12:00:00.000Z',
};

/* ---------------- 任务 ---------------- */

export const DEMO_TASKS: Task[] = [
  { id: 't1', title: '高数作业：定积分练习', courseId: 'c1', type: 'homework', estimateMin: 90, dueDate: '2026-09-11', done: false, priority: 95 },
  { id: 't2', title: '物理实验报告：光的干涉', courseId: 'c2', type: 'homework', estimateMin: 120, dueDate: '2026-09-13', done: false, priority: 80 },
  { id: 't3', title: 'C 语言：链表作业', courseId: 'c3', type: 'homework', estimateMin: 60, dueDate: '2026-09-12', done: false, priority: 70 },
  { id: 't4', title: '英语精读 Unit 3 单词', courseId: 'c4', type: 'review', estimateMin: 30, dueDate: undefined, done: false, priority: 40 },
  { id: 't5', title: '电路预习：戴维南定理', courseId: 'c5', type: 'review', estimateMin: 45, dueDate: undefined, done: false, priority: 62 },
  { id: 't6', title: '篮球训练', courseId: undefined, type: 'interest', estimateMin: 60, dueDate: undefined, done: false, priority: 20 },
];

/* ---------------- 学期阶段 ---------------- */

export const DEMO_PHASES: Phase[] = buildPhases('autumn', 18);

export const DEMO_PHASE_PLAN: PhasePlan = {
  phases: DEMO_PHASES,
  currentPhaseId: 'S1',
  currentWeek: 5,
  weeksLeft: 13,
};

/* ---------------- 周计划（第 5 周） ---------------- */

interface StudySlot { start: string; end: string; title: string; taskId: string; kind: 'study' | 'rest'; }

// 每个 weekday 的固定学习/兴趣块（演示用，手动编排，含大量留白）
const WEEK_STUDY: Record<number, StudySlot[]> = {
  1: [
    { start: '10:00', end: '11:40', title: '高数习题：定积分', taskId: 't1', kind: 'study' },
    { start: '15:10', end: '15:55', title: '电路预习：戴维南', taskId: 't5', kind: 'study' },
    { start: '16:10', end: '17:10', title: '篮球训练', taskId: 't6', kind: 'rest' },
    { start: '19:40', end: '21:10', title: '物理实验报告', taskId: 't2', kind: 'study' },
  ],
  2: [
    { start: '10:00', end: '11:00', title: 'C 语言：链表作业', taskId: 't3', kind: 'study' },
    { start: '19:30', end: '20:00', title: '英语单词', taskId: 't4', kind: 'study' },
  ],
  3: [
    { start: '10:00', end: '11:40', title: '高数习题', taskId: 't1', kind: 'study' },
    { start: '19:30', end: '21:30', title: '物理实验报告', taskId: 't2', kind: 'study' },
  ],
  4: [
    { start: '19:00', end: '19:45', title: '电路预习', taskId: 't5', kind: 'study' },
    { start: '20:00', end: '21:00', title: 'C 语言作业', taskId: 't3', kind: 'study' },
  ],
  5: [
    { start: '10:00', end: '10:30', title: '英语单词', taskId: 't4', kind: 'study' },
    { start: '15:00', end: '16:00', title: '摄影（兴趣）', taskId: 't6', kind: 'rest' },
  ],
  6: [
    { start: '15:00', end: '17:00', title: '篮球训练', taskId: 't6', kind: 'rest' },
  ],
  7: [],
};

const WEEKDAY_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function buildDay(date: string, weekday: number): DayPlan {
  const blocks: TimeBlock[] = [];

  // 三餐
  blocks.push({ start: '07:00', end: '07:30', kind: 'meal', title: '早餐' });
  blocks.push({ start: '11:45', end: '12:35', kind: 'meal', title: '午餐' });
  blocks.push({ start: '17:20', end: '18:10', kind: 'meal', title: '晚餐' });

  // 课程
  for (const c of DEMO_SCHEDULE.courses) {
    for (const s of c.slots) {
      if (s.dayOfWeek !== weekday) continue;
      const inWeek = s.weeks.length === 0 || s.weeks.includes(5);
      if (!inWeek) continue;
      blocks.push({
        start: PERIOD_START[s.startPeriod],
        end: PERIOD_END[s.endPeriod],
        kind: 'course',
        title: c.name,
        courseId: c.id,
        campus: c.campus,
        note: c.building ? `${c.building} ${c.room ?? ''}` : undefined,
      });
    }
  }

  // 学习/兴趣块
  for (const sb of WEEK_STUDY[weekday] ?? []) {
    blocks.push({ start: sb.start, end: sb.end, kind: sb.kind, title: sb.title, taskId: sb.taskId });
  }

  // 排序 + 留白填充（清醒窗口 08:00–22:00）
  blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const filled: TimeBlock[] = [];
  let cursor = 8 * 60; // 08:00
  for (const b of blocks) {
    const s = Math.max(toMinutes(b.start), cursor);
    if (toMinutes(b.end) < cursor) continue; // 早餐 07:00 已在窗口外，跳过
    if (s - cursor >= 30) {
      filled.push({ start: toHHmm(cursor), end: toHHmm(s), kind: 'blank', title: '留白' });
    }
    filled.push(b);
    cursor = toMinutes(b.end);
  }
  if (22 * 60 - cursor >= 30) {
    filled.push({ start: toHHmm(cursor), end: '22:00', kind: 'blank', title: '留白' });
  }

  const studyMin = filled.filter((b) => b.kind === 'study').reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0);
  const blankMin = filled.filter((b) => b.kind === 'blank').reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0);
  const courseMin = filled.filter((b) => b.kind === 'course').reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0);

  return { date, weekday, blocks: filled, studyMin, blankMin, courseMin };
}

export const DEMO_WEEK_PLAN: WeekPlan = (() => {
  const days: DayPlan[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const date = `2026-10-0${wd}`;
    const day = buildDay(date, wd);
    days.push({ ...day, weekday: wd });
  }
  const studyMin = days.reduce((s, d) => s + d.studyMin, 0);
  const blankMin = days.reduce((s, d) => s + d.blankMin, 0);
  const awakeTotal = 7 * (22 * 60 - 8 * 60);
  return {
    weekNo: 5,
    days,
    studyMin,
    blankMin,
    actualBlankRate: Math.round((blankMin / awakeTotal) * 100) / 100,
  };
})();

export const WEEKDAY_LABELS = WEEKDAY_LABEL;

/* ---------------- 期末冲刺（演示：假设已进入第 16 周） ---------------- */

export const DEMO_COUNTDOWNS: ExamCountdown[] = [
  { courseId: 'c5', courseName: '电路与电子技术', examDate: '2027-01-16', daysLeft: 21, urgency: 82, suggestMin: 120, level: 'T-21', action: '系统梳理：过一遍全部章节知识框架' },
  { courseId: 'c2', courseName: '大学物理（光学）', examDate: '2027-01-13', daysLeft: 14, urgency: 76, suggestMin: 100, level: 'T-14', action: '主攻薄弱：干涉/衍射计算题专项' },
  { courseId: 'c1', courseName: '高等数学 A（下）', examDate: '2027-01-11', daysLeft: 7, urgency: 68, suggestMin: 90, level: 'T-7', action: '刷真题：近三年卷 + 错题重做' },
  { courseId: 'c4', courseName: '大学英语（三）', examDate: '2027-01-09', daysLeft: 3, urgency: 44, suggestMin: 30, level: 'T-3', action: '轻量维持：作文模板 + 保持手感' },
];
