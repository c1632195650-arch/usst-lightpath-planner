/**
 * 批次 3（交互升级方案 2026-10-02）· 推荐层：类目分类 + 已排量统计 + 带依据推荐 + 协商选项扩容
 * ============================================================
 * 覆盖：
 *   · classifyGoal 关键词表（6.1）—— 二分类 + generic 默认，不穷举；
 *   · categoryMinutesOfWeek 聚合（6.2）—— 读侧视图，不动 types.ts；
 *   · evidenceLine 带依据推荐（6.3）—— 依据必有来源（健康库/方法库 + tier）；
 *   · effort 快捷项 hints（6.3/6.4）—— 恰一条依据行 + tips 轮换；
 *   · 协商选项扩容 ⑤换空档/⑥拆分（6.5）—— 全部过干跑闸才出现。
 *
 * ⚠️ 反向验证（reversed-verified，删改实测见 commit message）：
 *   · 删 ⑤ 的干跑闸（feasible）→ 排不上的日子也出「改到」→ 红；
 *   · 删 ⑥ 的 60 分钟下限 → 30 分钟目标也出「拆成两天」→ 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Course, Schedule, TimeBlock, WeekPlan } from '@/types';
import { classifyGoal, evidenceLine } from '@/features/libao/taxonomy';
import {
  categoryMinutesOfWeek,
  checkGoalFeasibility,
  proposeReplanOptions,
  quickOptionsFor,
} from '@/features/libao/weekPlanForChat';
import { applyClarifyAnswers, mergeLlmPrimary, parseIntentSlots, type IntentSlots } from '@/features/libao/libaoIntent';
import type { UserTask } from '@/lib/planner/templates';

const TERM_START = '2026-09-07'; // 周一
const TODAY = '2026-09-07';

/* ============================================================
 * 一、classifyGoal（6.1）
 * ========================================================== */

test('分类 · 运动/学习二分与 generic 默认', () => {
  assert.equal(classifyGoal('打篮球'), 'sport-aerobic');
  assert.equal(classifyGoal('晨跑'), 'sport-aerobic');
  assert.equal(classifyGoal('去健身房练背'), 'sport-strength');
  assert.equal(classifyGoal('力量训练'), 'sport-strength');
  assert.equal(classifyGoal('四六级真题'), 'study-course');
  assert.equal(classifyGoal('高数复习'), 'study-course');
  assert.equal(classifyGoal('数学建模备赛'), 'study-research');
  assert.equal(classifyGoal('实验报告'), 'study-research');
  assert.equal(classifyGoal('学画画'), 'generic');
  assert.equal(classifyGoal(''), 'generic');
});

/* ============================================================
 * 二、categoryMinutesOfWeek（6.2）
 * ========================================================== */

function block(id: string, title: string, kind: TimeBlock['kind'], day: number, start: number, end: number): TimeBlock {
  return {
    id,
    title,
    kind,
    category: 'custom',
    dayOfWeek: day,
    startMin: start,
    endMin: end,
    weeks: [1],
  } as TimeBlock;
}

const PLAN: WeekPlan = {
  weekNo: 1,
  blocks: [
    block('b1', '操场跑步', 'activity', 1, 1080, 1140), // 60min 有氧
    block('b2', '篮球', 'activity', 3, 1080, 1200),    // 120min 有氧
    block('b3', '健身房力量', 'activity', 4, 1080, 1200), // 120min 力量
    block('b4', '图书馆自习', 'study', 2, 540, 660),   // study，无关键词 → generic
  ],
  stats: { studyMin: 120, blankMin: 0, blockCount: 4 },
} as unknown as WeekPlan;

test('统计 · 本周类目分钟数只认「activity/study + 标题关键词」', () => {
  assert.equal(categoryMinutesOfWeek(PLAN, 'sport-aerobic'), 180);
  assert.equal(categoryMinutesOfWeek(PLAN, 'sport-strength'), 120);
  assert.equal(categoryMinutesOfWeek(PLAN, 'study-course'), 0, '「图书馆自习」无关键词 → generic，不计入 course');
  assert.equal(categoryMinutesOfWeek(PLAN, 'generic'), 120);
});

/* ============================================================
 * 三、evidenceLine（6.3）：依据必有来源，generic 宁可不说不编
 * ========================================================== */

test('依据 · 运动类引健康库（A级）+ 个性化输入；generic 不出依据', () => {
  const a = evidenceLine('sport-aerobic', { weekMinutes: 180, exercisePerWeek: 3 });
  assert.ok(a!.includes('健康库（A级）'), a);
  assert.ok(a!.includes('≥150 分钟'), a);
  assert.ok(a!.includes('你本周已排 180 分钟'), a);
  assert.ok(a!.includes('你自报每周运动 3 次'), a);

  const s = evidenceLine('sport-strength', {});
  assert.ok(s!.includes('每周 ≥2 天'), s);

  const c = evidenceLine('study-course');
  assert.ok(c!.includes('方法库'), c);
  const r = evidenceLine('study-research');
  assert.ok(r!.includes('72 小时'), r);

  assert.equal(evidenceLine('generic'), undefined, 'generic 没有权威口径，不出依据行');
  assert.equal(evidenceLine('sport-aerobic', {}), '依据：健康库（A级）中高强度每周 ≥150 分钟 —— 建议单次 45-90 分钟',
    '没有个性化输入时也有干净的依据行');
});

test('effort 快捷项 · 恰一条依据行 + 其余为 tips 轮换（单日/长期两形态）', () => {
  const slots: IntentSlots = { ...parseIntentSlots('明天要打篮球', TODAY), title: '打篮球' };
  const single = quickOptionsFor('effort', slots, { today: TODAY, exercisePerWeek: 2 });
  const withEvidence = single.filter((o) => o.hint?.includes('依据：'));
  assert.equal(withEvidence.length, 1, `恰一条依据行，实际 ${withEvidence.length}`);
  assert.ok(withEvidence[0].hint!.includes('健康库（A级）'));
  assert.ok(single.every((o) => (o.hint ?? '').length > 0), '每项都有次行小字');

  const long = quickOptionsFor('effort', { ...slots, when: { text: '九月中旬', kind: 'window', month: 9, decade: 'middle' } }, { today: TODAY });
  assert.equal(long.filter((o) => o.hint?.includes('依据：')).length, 1);
});

/* ============================================================
 * 四、协商选项扩容（6.5）：⑤换空档 / ⑥拆分，全过干跑闸
 * ========================================================== */

function course(id: string, name: string, building: string, dayOfWeek: number, startPeriod: number, endPeriod: number, weeks: number[]): Course {
  return {
    id, name, credit: 2, category: '公共基础', campus: 'JG516', building,
    slots: [{ dayOfWeek: dayOfWeek as Course['slots'][number]['dayOfWeek'], startPeriod, endPeriod, weeks }],
  };
}

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: TERM_START,
  totalWeeks: 20,
  source: 'demo',
  courses: [course('c1', '大学物理A(2)', '第一教学楼', 1, 1, 2, [2, 3])],
};

/**
 * 撞车型 blocked 场景：用户约定「每周一晚上 2 小时」，而周一晚上被既有活动
 * 占满 → 引擎放不进任何一块。⑤ 要放开星期钉才扫得到别的日子；⑥ 要翻倍频率
 * 才摊得开 —— 两个新方案在这个场景里都必须真实出现。
 */
function blockedScenario(): { slots: IntentSlots; verdict: ReturnType<typeof checkGoalFeasibility>; tasks: UserTask[] } {
  const slots: IntentSlots = {
    ...parseIntentSlots('帮我排个实验报告', TODAY),
    title: '实验报告',
    intent: 'create',
    when: { text: '每周一晚上', kind: 'window', recurring: true, weekday: 1 },
    perWeekCount: 1,
    durationMin: 120,
    window: { fromMin: 1080, toMin: 1380, text: '晚上' },
    dateFrom: '2026-09-15',
    dateTo: '2026-09-21',
    certainty: 'window',
    priorityHint: 80,
    missing: [],
  };
  // 周一晚上的既有活动（引擎块）：18:00-23:00 全占
  const tasks: UserTask[] = [{
    id: 'busy-mon-evening',
    title: '社团值班',
    emoji: '📌',
    kind: 'activity',
    category: 'custom',
    dayOfWeek: 1,
    weeks: [3],
    durationMin: 300,
    notBeforeMin: 1080,
    priority: 90,
    budgetExempt: true,
  }];
  const verdict = checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, today: TODAY, tasks });
  return { slots, verdict, tasks };
}

test('扩容 · blocked 态选项 ≥3 条：⑤换空档带真实落点、⑥拆分、全部干跑过', () => {
  const { slots, verdict, tasks } = blockedScenario();
  assert.ok(verdict.kind === 'conflict' || verdict.kind === 'infeasible', `场景应 blocked，实际 ${verdict.kind}`);
  const options = proposeReplanOptions({ slots, verdict, schedule: SCHEDULE, profile: null, today: TODAY, tasks });
  assert.ok(options.length >= 3, `扩容后应 ≥3 条，实际 ${options.length}：${options.map((o) => o.id).join(',')}`);
  assert.ok(options.length <= 4, '上限 4 条');
  assert.ok(options.some((o) => o.id.startsWith('move_to:')), '⑤ 换空档应出现');
  assert.ok(options.some((o) => o.id === 'split'), '⑥ 拆分应出现');

  const moveTo = options.filter((o) => o.id.startsWith('move_to:'));
  for (const o of moveTo) {
    assert.match(o.label, /改到周[一二三四五六日]/, `⑤ 的 label 要带真实落点：${o.label}`);
    assert.equal(o.slots.dateFrom, o.slots.dateTo, '⑤ 收成单日');
  }
  const split = options.find((o) => o.id === 'split');
  if (split) {
    assert.ok(split.slots.durationMin! < slots.durationMin!, '⑥ 单次应减半');
  }
  // 每条选项都真的排得上：干跑复核全过（闸门在 proposeReplanOptions 内）
  for (const o of options) {
    const v = checkGoalFeasibility({ slots: { ...o.slots, missing: [] }, schedule: SCHEDULE, profile: null, today: TODAY, tasks });
    assert.ok(v.kind === 'ok' || v.kind === 'tight', `选项 ${o.id} 干跑应可行，实际 ${v.kind}`);
  }
});

test('扩容 · 单次 30 分钟不产 ⑥拆分（没有拆的意义）；容量型冲突如实少选项', () => {
  const { slots, verdict, tasks } = blockedScenario();
  const half = { ...slots, durationMin: 30 };
  const v2 = checkGoalFeasibility({ slots: half, schedule: SCHEDULE, profile: null, today: TODAY, tasks });
  const options = proposeReplanOptions({ slots: half, verdict: v2, schedule: SCHEDULE, profile: null, today: TODAY, tasks });
  assert.ok(!options.some((o) => o.id === 'split'), '30 分钟不应出拆分选项');

  // 容量型冲突（「一共10小时」收在单日窗）：单日换空档是诚实的不可能 → ⑤ 不出，
  // 选项可以 <3 条 —— 界面必须如实说「可选的路有限」，不编第 3 条（方案 6.5）。
  const base = parseIntentSlots('帮我排个实验报告', TODAY);
  const cap = mergeLlmPrimary(applyClarifyAnswers('下周一开始；一共10小时', base, base.missing, TODAY).slots, { title: '实验报告' }, TODAY);
  const capV = checkGoalFeasibility({ slots: cap, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.equal(capV.kind, 'conflict');
  const capOptions = proposeReplanOptions({ slots: cap, verdict: capV, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.ok(capOptions.length < 3, `容量型冲突应如实少选项，实际 ${capOptions.length}`);
  assert.ok(capOptions.some((o) => o.id === 'reduce_total'));
});
