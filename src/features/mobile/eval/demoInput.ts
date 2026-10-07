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
 *
 * 2026-10-07 修订（决赛演示）：原样例日期写死 2026-09-30 → 2026-10-07，
 * 拍摄日一过「今天」列就错位 —— 改为**动态锚定真实今天**（模块加载时定一次），
 * 8 天窗口 = 今天往前推 7 天；done 模式 / 晚开始分钟数 / 拖延天数全部按窗口索引取值，
 * 样例故事不变：大多数完成、两天中断、拖延有两单、自评中等偏上。
 */
import type { TimeBlock } from '@/types';
import type { EvalInput } from './model.ts';

/** 本地时区 YYYY-MM-DD（本文件保持零依赖，不引 lib 工具） */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function offsetDayKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDayKey(d);
}

/** 样例「今天」与 8 天窗口（窗口末位 = 真实今天；模块加载时定一次，dev 单次打开足够） */
export const DEMO_TODAY_KEY = localDayKey(new Date());
export const DEMO_EVAL_DAYS = Array.from({ length: 8 }, (_, i) => offsetDayKey(i - 7));
/** 窗口第 i 天的 dayKey（i=0 最早，i=7 是样例「今天」） */
const DAY = (i: number) => DEMO_EVAL_DAYS[i];

/** 每天 3 个计划块（学习 / 吃饭 / 运动），done 逐日不同 —— 完成率与连续性的原料 */
const DONE_PATTERN = [
  [true, true, true],    // D0
  [true, true, false],   // D1
  [true, true, true],    // D2
  [true, false, true],   // D3
  [false, true, false],  // D4（整周唯一的全天低谷 —— 连续性中断原料）
  [true, true, true],    // D5
  [true, true, false],   // D6
  [true, false, false],  // D7（样例「今天」，还没过完）
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
  { blockId: `${DAY(0)}-study`, plannedDayKey: DAY(0), plannedStartMin: 9 * 60, checkedDayKey: DAY(0), checkedMin: 9 * 60 + 6, undone: false },
  { blockId: `${DAY(1)}-study`, plannedDayKey: DAY(1), plannedStartMin: 9 * 60, checkedDayKey: DAY(1), checkedMin: 9 * 60 + 18, undone: false },
  { blockId: `${DAY(2)}-study`, plannedDayKey: DAY(2), plannedStartMin: 9 * 60, checkedDayKey: DAY(2), checkedMin: 9 * 60 - 5, undone: false },
  { blockId: `${DAY(3)}-meal`, plannedDayKey: DAY(3), plannedStartMin: 12 * 60, checkedDayKey: DAY(3), checkedMin: 12 * 60 + 2, undone: false },
  { blockId: `${DAY(5)}-study`, plannedDayKey: DAY(5), plannedStartMin: 9 * 60, checkedDayKey: DAY(5), checkedMin: 9 * 60 + 11, undone: false },
  { blockId: `${DAY(6)}-study`, plannedDayKey: DAY(6), plannedStartMin: 9 * 60, checkedDayKey: DAY(6), checkedMin: 9 * 60 + 25, undone: false },
  { blockId: `${DAY(7)}-study`, plannedDayKey: DAY(7), plannedStartMin: 9 * 60, checkedDayKey: DAY(7), checkedMin: 9 * 60 + 9, undone: false },
];

/** 中长期待办：3 条已办（拖延指数原料），2 条未办（unknown，不进分母） */
const lateTodos: EvalInput['lateTodos'] = [
  { todoId: 'td-a', horizon: 'long', plannedDoneDayKey: DAY(1), actualDoneDayKey: DAY(2) },
  { todoId: 'td-b', horizon: 'long', plannedDoneDayKey: DAY(3), actualDoneDayKey: DAY(5) },
  { todoId: 'td-c', horizon: 'long', plannedDoneDayKey: DAY(5), actualDoneDayKey: DAY(5) },
  { todoId: 'td-d', horizon: 'long', plannedDoneDayKey: offsetDayKey(3), actualDoneDayKey: null },
  { todoId: 'td-e', horizon: 'long', plannedDoneDayKey: offsetDayKey(8), actualDoneDayKey: null },
];

/** 自评答题：4 天 × 若干 slug，score 0..4 */
const answers: EvalInput['answers'] = [
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: DAY(3), score: 2 },
  { questionId: 'q2', slug: 'procrastination-regulation', dayKey: DAY(3), score: 1 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: DAY(5), score: 3 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: DAY(6), score: 2 },
  { questionId: 'q3', slug: 'sleep-regularity', dayKey: DAY(6), score: 2 },
  { questionId: 'q1', slug: 'implementation-intentions', dayKey: DAY(7), score: 3 },
];

export const DEMO_EVAL_INPUT: EvalInput = { units, lateTodos, checks, answers };

/** 通知样例：一天 6 个块（含一个已结束的早读）；样例时刻 = 今天 14:20。
 *  dayOfWeek 跟随真实今天（演示「今天的通知计划」不穿帮）。 */
const DEMO_DOW = (((new Date().getDay() + 6) % 7) + 1) as TimeBlock['dayOfWeek'];
export const DEMO_NOW_MIN = 14 * 60 + 20;
export const DEMO_DAY_BLOCKS: TimeBlock[] = [
  { id: 'demo-d0-study-0', kind: 'study', dayOfWeek: DEMO_DOW, startMin: 8 * 60, endMin: 8 * 60 + 45, title: '早读（已结束）', emoji: '📕', source: 'template' },
  { id: 'demo-d0-study-1', kind: 'study', dayOfWeek: DEMO_DOW, startMin: 9 * 60, endMin: 10 * 60 + 30, title: '大物习题', emoji: '📘', place: '一教 302', source: 'template' },
  { id: 'demo-d0-meal-1', kind: 'meal', dayOfWeek: DEMO_DOW, startMin: 12 * 60, endMin: 13 * 60, title: '午饭', emoji: '🍚', place: '五食堂', source: 'template' },
  { id: 'demo-d0-study-2', kind: 'study', dayOfWeek: DEMO_DOW, startMin: 14 * 60 + 30, endMin: 16 * 60, title: '英语阅读', emoji: '📖', place: '图书馆', source: 'template' },
  { id: 'demo-d0-move-1', kind: 'activity', dayOfWeek: DEMO_DOW, startMin: 17 * 60, endMin: 17 * 60 + 40, title: '慢跑', emoji: '🏃', place: '操场', source: 'template' },
  { id: 'demo-d0-date-1', kind: 'activity', dayOfWeek: DEMO_DOW, startMin: 19 * 60, endMin: 20 * 60 + 30, title: '吃大餐', emoji: '📌', place: '', source: 'user' },
];
