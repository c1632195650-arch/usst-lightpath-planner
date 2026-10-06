/**
 * M4a（2026-10-07）· dev 专用「输入样例」（CY 反馈⑧b：要样例，但必须走真实生成渠道）
 * ============================================================
 * ⚠️ 这是**输入**样例；结果由 `computeExecutionProfile` / `dailySeries` /
 * `planTodayNotifications` **现场算出**。**禁止**把结果写死在此文件
 * （红线 6：结果样例里出现的数字/文案在 src/ 下 grep 必须 0 命中 —— 结果只能算出来）。
 *
 * 生效条件（EvalSection / NotifyStatus 接线）：`import.meta.env.DEV` 且
 * `?demoEval` 在地址里，或 `localStorage['usst.mobile.demoEval']==='1'`。
 * UI 上必须带「样例数据」角标（m-eval-demo-badge），不得伪装成真实数据。
 */
import type { TimeBlock } from '@/types';
import type { EvalInput } from './model.ts';

/** 样例「今天」与 8 天窗口（2026-09-30 → 2026-10-07） */
export const DEMO_TODAY_KEY = '2026-10-07';
export const DEMO_EVAL_DAYS = [
  '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
  '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
];

/** 每天 3 个计划块（学习 / 吃饭 / 运动），done 逐日不同 —— 完成率与连续性的原料 */
const DONE_PATTERN = [
  [true, true, true],    // 09-30
  [true, true, false],   // 10-01
  [true, true, true],    // 10-02
  [true, false, true],   // 10-03
  [false, true, false],  // 10-04
  [true, true, true],    // 10-05
  [true, true, false],   // 10-06
  [true, false, false],  // 10-07（样例「今天」，还没过完）
];
const BLOCK_KINDS = ['study', 'meal', 'move'] as const;

const units = [] as EvalInput['units'];
DEMO_EVAL_DAYS.forEach((dayKey, i) => {
  BLOCK_KINDS.forEach((kind, j) => {
    units.push({ dayKey, blockId: `${dayKey}-${kind}`, done: DONE_PATTERN[i][j] });
  });
});

/** 勾完成记录：checkedMin − plannedStartMin = 时间纪律的「晚开始」原料 */
const checks: EvalInput['checks'] = [
  { blockId: '2026-09-30-study', plannedDayKey: '2026-09-30', plannedStartMin: 9 * 60, checkedDayKey: '2026-09-30', checkedMin: 9 * 60 + 6, undone: false },
  { blockId: '2026-10-01-study', plannedDayKey: '2026-10-01', plannedStartMin: 9 * 60, checkedDayKey: '2026-10-01', checkedMin: 9 * 60 + 18, undone: false },
  { blockId: '2026-10-02-study', plannedDayKey: '2026-10-02', plannedStartMin: 9 * 60, checkedDayKey: '2026-10-02', checkedMin: 9 * 60 - 5, undone: false },
  { blockId: '2026-10-03-meal', plannedDayKey: '2026-10-03', plannedStartMin: 12 * 60, checkedDayKey: '2026-10-03', checkedMin: 12 * 60 + 2, undone: false },
  { blockId: '2026-10-05-study', plannedDayKey: '2026-10-05', plannedStartMin: 9 * 60, checkedDayKey: '2026-10-05', checkedMin: 9 * 60 + 11, undone: false },
  { blockId: '2026-10-06-study', plannedDayKey: '2026-10-06', plannedStartMin: 9 * 60, checkedDayKey: '2026-10-06', checkedMin: 9 * 60 + 25, undone: false },
  { blockId: '2026-10-07-study', plannedDayKey: '2026-10-07', plannedStartMin: 9 * 60, checkedDayKey: '2026-10-07', checkedMin: 9 * 60 + 9, undone: false },
];

/** 中长期待办：3 条已办（拖延指数原料），2 条未办（unknown，不进分母） */
const lateTodos: EvalInput['lateTodos'] = [
  { todoId: 'td-a', horizon: 'long', plannedDoneDayKey: '2026-10-01', actualDoneDayKey: '2026-10-02' },
  { todoId: 'td-b', horizon: 'long', plannedDoneDayKey: '2026-10-03', actualDoneDayKey: '2026-10-05' },
  { todoId: 'td-c', horizon: 'long', plannedDoneDayKey: '2026-10-05', actualDoneDayKey: '2026-10-05' },
  { todoId: 'td-d', horizon: 'long', plannedDoneDayKey: '2026-10-10', actualDoneDayKey: null },
  { todoId: 'td-e', horizon: 'long', plannedDoneDayKey: '2026-10-15', actualDoneDayKey: null },
];

/** 自评答题：4 天 × 若干 slug，score 0..4 */
const answers: EvalInput['answers'] = [
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: '2026-10-03', score: 2 },
  { questionId: 'q2', slug: 'procrastination-regulation', dayKey: '2026-10-03', score: 1 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: '2026-10-05', score: 3 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: '2026-10-06', score: 2 },
  { questionId: 'q3', slug: 'sleep-regularity', dayKey: '2026-10-06', score: 2 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: '2026-10-07', score: 3 },
];

export const DEMO_EVAL_INPUT: EvalInput = { units, lateTodos, checks, answers };

/** 通知样例：一天 6 个块（含一个已结束的早读）；样例时刻 = 今天 14:20 */
export const DEMO_NOW_MIN = 14 * 60 + 20;
export const DEMO_DAY_BLOCKS: TimeBlock[] = [
  { id: 'w6-d3-study-1', kind: 'study', dayOfWeek: 3, startMin: 9 * 60, endMin: 10 * 60 + 30, title: '大物习题', emoji: '📘', place: '一教 302', source: 'template' },
  { id: 'w6-d3-meal-1', kind: 'meal', dayOfWeek: 3, startMin: 12 * 60, endMin: 13 * 60, title: '午饭', emoji: '🍚', place: '五食堂', source: 'template' },
  { id: 'w6-d3-study-2', kind: 'study', dayOfWeek: 3, startMin: 14 * 60 + 30, endMin: 16 * 60, title: '英语阅读', emoji: '📖', place: '图书馆', source: 'template' },
  { id: 'w6-d3-move-1', kind: 'activity', dayOfWeek: 3, startMin: 17 * 60, endMin: 17 * 60 + 40, title: '慢跑', emoji: '🏃', place: '操场', source: 'template' },
  { id: 'w6-d3-date-1', kind: 'activity', dayOfWeek: 3, startMin: 19 * 60, endMin: 20 * 60 + 30, title: '吃大餐', emoji: '📌', place: '', source: 'user' },
  { id: 'w6-d3-study-0', kind: 'study', dayOfWeek: 3, startMin: 8 * 60, endMin: 8 * 60 + 45, title: '早读（已结束）', emoji: '📕', source: 'template' },
];
