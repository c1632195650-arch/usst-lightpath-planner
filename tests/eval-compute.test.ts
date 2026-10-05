/**
 * 任务二 P1-1/P1-2 · 五维计算纯函数单测
 * ============================================================
 * 覆盖：每维「正常 / 空数据 / 仅 1 条数据」三态（任务书 P1-1 验收）；
 *      时间纪律「提前 / 准时 / 拖延 / 无记录」四态（P1-2 验收）；
 *      连续性本地日历日 + 跨零点用例（P1-3 变异体 ③ 的绿侧锚点）。
 *
 * ⚠️ 反向验证记录见 tests/eval-mutations.log.md（三组红绿对照）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLD_START_DAYS, completionRate, computeExecutionProfile, continuity, dailySeries,
  dayDiff, deviationMin, healthOf, offsetDayKey, pickFocus, procrastinationIndex,
  selfReportProfile, timeDiscipline,
} from '@/features/mobile/eval/compute.ts';
import type { CompletionUnit, EvalInput, LateTodoRecord, SelfReportAnswer } from '@/features/mobile/eval/model.ts';

const TODAY = '2026-10-06';

function unit(dayKey: string, blockId: string, done: boolean): CompletionUnit {
  return { dayKey, blockId, done };
}

function daysBackFrom(n: number, today: string): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = offsetDayKey(today, -i);
    if (k) out.push(k);
  }
  return out;
}

/* ---------- 日期工具 ---------- */

test('dayDiff / offsetDayKey：本地日历日算术，非法输入返回 null', () => {
  assert.equal(dayDiff('2026-10-01', '2026-10-06'), 5);
  assert.equal(dayDiff('2026-10-06', '2026-10-01'), -5);
  assert.equal(dayDiff('2026-13-40', '2026-10-06'), null);
  assert.equal(offsetDayKey('2026-10-01', 7), '2026-10-08');
  assert.equal(offsetDayKey('2026-10-01', -1), '2026-09-30');
  assert.equal(offsetDayKey('garbage', 1), null);
});

/* ---------- 维度 1 · 任务完成率 ---------- */

test('完成率：空数据 → 累积中（sampleSize 0），绝不给 0 分', () => {
  const r = completionRate([], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
  assert.equal(r.sampleSize, 0);
});

test('完成率：样本跨度不足 7 天 → 累积中（N/7）', () => {
  const units = [
    unit('2026-10-05', 'b1', true),
    unit('2026-10-05', 'b2', false),
    unit('2026-10-06', 'b1', true),
  ];
  const r = completionRate(units, TODAY); // 最早 10-05，跨度 2 天
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
  assert.equal(r.sampleSize, 2);
});

test('完成率：跨度满 7 天 → 可判，值为勾选百分比', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY); // 09-30..10-06
  const units: CompletionUnit[] = [
    ...days.slice(0, 6).map((d, i) => unit(d, `b${i}`, true)),
    unit(days[6], 'b10', false),
    unit(days[6], 'b11', true),
  ];
  const r = completionRate(units, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, Math.round((100 * 7) / 8));
});

test('完成率：未来日期的记录被忽略（不虚增样本）', () => {
  const r = completionRate([unit('2026-10-07', 'b1', true)], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.sampleSize, 0);
});

/* ---------- 维度 3 · 连续性 ---------- */

test('连续性：空数据 → 累积中', () => {
  const r = continuity([], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
});

test('连续性：跨零点的两次勾选是两个本地日历日，streak = 2（24h 窗口会把它并成 1 → 变异体 ③ 红）', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY);
  const units: CompletionUnit[] = [
    unit(days[0], 'seed', true), // 铺满 7 天跨度，否则冷启动直接「累积中」
    unit(days[days.length - 2], 'late-block', true), // 昨天 23:59 勾的
    unit(days[days.length - 1], 'early-block', true), // 今天 00:01 勾的
  ];
  const r = continuity(units, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, 2, '昨天和今天是两个日历日，连续 2 天');
});

test('连续性：中间断了一天 → streak 只算最近一段（断档不许被 24h 窗口接上）', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY);
  const units: CompletionUnit[] = [
    unit(days[0], 'a', true),
    unit(days[1], 'a', true),
    // days[2] 缺席
    unit(days[3], 'a', true),
    unit(days[4], 'a', true),
    unit(days[5], 'a', true),
    unit(days[6], 'a', true),
  ];
  const r = continuity(units, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, 4, '09-30、10-01 完成，10-02 断，10-03 起连续 4 天');
});

test('连续性：今天还没勾 → 从昨天起算（今天没过完不算断）', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY);
  const units = days.slice(0, 6).map((d) => unit(d, 'a', true)); // 到昨天为止连续
  const r = continuity(units, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, 6);
});

/* ---------- 维度 4 · 时间纪律（P1-2 四态） ---------- */

test('偏差：提前（负值）原样返回，汇总时才钳 0', () => {
  assert.equal(deviationMin({ plannedDayKey: TODAY, plannedStartMin: 600, checkedDayKey: TODAY, checkedMin: 590 }), -10);
});

test('偏差：跨零点勾选（计划 23:30 / 勾于次日 00:10）= +40 分钟，不是 -1390', () => {
  assert.equal(
    deviationMin({ plannedDayKey: '2026-10-05', plannedStartMin: 1410, checkedDayKey: '2026-10-06', checkedMin: 10 }),
    40,
  );
});

test('时间纪律：无记录 → 累积中（unknown 不当 0）', () => {
  const r = timeDiscipline([], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
});

test('时间纪律：四态混合 —— 提前/准时计 0，拖延计正差，缺记录的块不进样本', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY);
  const checks = [
    // 提前 10 分钟（钳 0）
    { blockId: 'a', plannedDayKey: days[0], plannedStartMin: 600, checkedDayKey: days[0], checkedMin: 590, undone: false },
    // 准时（0）
    { blockId: 'b', plannedDayKey: days[1], plannedStartMin: 600, checkedDayKey: days[1], checkedMin: 600, undone: false },
    // 拖延 60 分钟
    { blockId: 'c', plannedDayKey: days[2], plannedStartMin: 600, checkedDayKey: days[2], checkedMin: 660, undone: false },
    // days[3] 的块勾了但后来取消 → 不计入
    { blockId: 'd', plannedDayKey: days[3], plannedStartMin: 600, checkedDayKey: days[3], checkedMin: 700, undone: true },
  ];
  const r = timeDiscipline(checks, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) {
    assert.equal(r.value, 20, 'mean(0, 0, 60) = 20；取消的 d 不计入');
    assert.equal(r.sampleSize, 3);
    assert.ok(r.basis.objective[0]!.includes('提前 1 条'), '提前完成的条数在依据里可追溯');
  }
});

/* ---------- 维度 2 · 拖延指数 ---------- */

function longTodo(planned: string, actual: string | null): LateTodoRecord {
  return { todoId: `t-${planned}-${actual}`, horizon: 'long', plannedDoneDayKey: planned, actualDoneDayKey: actual };
}

test('拖延指数：无已完成的中长期待办 → 累积中（任务三 todos 未落地时的真实形态）', () => {
  const r = procrastinationIndex([], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
});

test('拖延指数：仅 1 条已完成即可判（任务书 P0-2 口径），提前完成计 0 不计负', () => {
  const r = procrastinationIndex([longTodo('2026-10-05', '2026-10-03')], TODAY); // 提前 2 天
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, 0);
});

test('拖延指数：均值只算正拖延；未完成（null）与短期待办不进样本', () => {
  const todos: LateTodoRecord[] = [
    longTodo('2026-10-01', '2026-10-03'), // 晚 2 天
    longTodo('2026-09-28', '2026-10-01'), // 晚 3 天
    longTodo('2026-10-03', '2026-10-02'), // 提前 → 0
    longTodo('2026-10-01', null), // 未完成 = unknown
    { todoId: 's1', horizon: 'short', plannedDoneDayKey: '2026-10-01', actualDoneDayKey: '2026-10-05' }, // 短期不进
  ];
  const r = procrastinationIndex(todos, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) {
    assert.equal(r.value, 1.7, 'mean(2, 3, 0) = 1.666… → 1.7');
    assert.equal(r.sampleSize, 3);
  }
});

/* ---------- 维度 5 · 自我报告 ---------- */

function answer(dayKey: string, score: number, questionId = 'q1'): SelfReportAnswer {
  return { questionId, slug: 'pomodoro', dayKey, score };
}

test('自我报告：无答题 → 累积中', () => {
  const r = selfReportProfile([], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.value, null);
});

test('自我报告：答题日 <3 天 → 累积中（阈值在此申报）', () => {
  const r = selfReportProfile([answer('2026-10-05', 4), answer('2026-10-06', 2, 'q2')], TODAY);
  assert.equal(r.confident, false);
  assert.equal(r.sampleSize, 2);
});

test('自我报告：≥3 个答题日 → 0..100 均分；非法分数被剔除', () => {
  const answers = [
    answer('2026-10-04', 4),
    answer('2026-10-05', 2, 'q2'),
    answer('2026-10-06', 3, 'q3'),
    answer('2026-10-06', 99, 'q4'), // 非法，剔除
  ];
  const r = selfReportProfile(answers, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, Math.round((100 * 3) / 4), 'mean(4,2,3)=3 → 75');
});

/* ---------- 汇总 / 焦点建议 / 每日曲线 ---------- */

test('pickFocus：不可判的维度不参与（null 不当 0 用 —— 变异体 ② 的绿侧锚点）', () => {
  const input: EvalInput = { units: [], lateTodos: [], checks: [], answers: [] };
  const p = computeExecutionProfile(input, TODAY);
  assert.equal(p.focus, null, '全部累积中 → 没有建议，而不是挑一个 0 分的');
  for (const dim of ['completion', 'procrastination', 'continuity', 'timeDiscipline', 'selfReport'] as const) {
    assert.equal(p.dims[dim].confident, false);
    assert.equal(p.dims[dim].value, null);
  }
});

test('pickFocus：挑健康度最低的**可判**维度，并给对应方法', () => {
  const days = daysBackFrom(COLD_START_DAYS, TODAY);
  const input: EvalInput = {
    units: days.map((d) => unit(d, 'a', true)), // completion=100, continuity=7 → 健康
    lateTodos: [],
    checks: [{
      blockId: 'a', plannedDayKey: days[0], plannedStartMin: 600,
      checkedDayKey: days[0], checkedMin: 600 + 55, undone: false, // 拖 55 分钟 → 健康 1-55/60 ≈ 0.08 最弱
    }],
    answers: days.slice(0, 3).map((d, i) => answer(d, 4 - i, `q${i}`)),
  };
  const p = computeExecutionProfile(input, TODAY);
  assert.ok(p.focus, '有可判维度 → 必有建议');
  assert.equal(p.focus!.dim, 'timeDiscipline');
  assert.equal(p.focus!.tip.slug, 'time-blocking');
});

test('healthOf：各维归一有界，拖延/纪律越拖越低', () => {
  assert.equal(healthOf('completion', 100), 1);
  assert.equal(healthOf('procrastination', 0), 1);
  assert.ok(healthOf('procrastination', 5) < healthOf('procrastination', 1));
  assert.ok(healthOf('timeDiscipline', 70) === 0);
  assert.ok(healthOf('continuity', 7) === 1);
});

test('dailySeries：当天无样本 → null 断点，绝不补 0', () => {
  const days = daysBackFrom(7, TODAY);
  const input: EvalInput = {
    units: [unit(days[0], 'a', true), unit(days[0], 'b', false), unit(days[6], 'c', true)],
    lateTodos: [],
    checks: [],
    answers: [answer(days[6], 4, 'q9')],
  };
  const s = dailySeries(input, days);
  assert.equal(s.completion[0], 50);
  assert.equal(s.completion[1], null, '10-01 没有任何块 → 断点');
  assert.equal(s.completion[6], 100);
  assert.equal(s.continuity[0], 1, '09-30 当天有完成 → 截至 09-30 连续 1 天');
  assert.equal(s.continuity[1], 1, '10-01 没完成，但昨天（09-30）有 → 仍算 1 天连续');
  assert.equal(s.continuity[2], 0, '10-02 往前一天（10-01）也没有完成 → 断了，真 0');
  assert.equal(s.timeDiscipline[0], null, '没勾完成记录 → null');
  assert.equal(s.selfReport[6], 100);
});
