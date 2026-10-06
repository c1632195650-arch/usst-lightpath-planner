/**
 * R 批 Wave3 · H3/H4 —— 作息接线 + 成长维度（纯函数层 + 源码锁）
 * ============================================================
 * H3：作息设置真源（routineStore，Q1a/Q1b，与引擎日窗同一份）接进摘要 ——
 *     「你 declare 的节奏」是可得的最好数据源（没有手环/监测）；
 *     未设置时如实 unknown，绝不冒充 0。
 * H4：成长维度接 GoalsPage（active 目标 × 本周相关块 + weeksLeft 折算在调用方）
 *     与 R5.2 recurring 重复任务的学期覆盖。
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-H3 ← 删 digestBlocks 的作息冲突计算分支 → 「就寝冲突」用例红
 *   RV-H4a ← 删 evaluateDigest 的 evalGrowth 注册 → 「成长维度」用例红
 *   RV-H4b ← 删 WeekPlanView 的 evalCtx 接线 → 源码锁红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { digestBlocks, digestPlan } from '@/lib/planner/planDigest';
import { evaluateDigest } from '@/lib/planner/planEval';
import type { TimeBlock } from '@/types';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

const block = (id: string, day: number, start: number, end: number, title: string, kind: TimeBlock['kind'] = 'activity'): TimeBlock =>
  ({ id, kind, dayOfWeek: day, startMin: start, endMin: end, title } as TimeBlock);

const PLAN = {
  weekNo: 12,
  blocks: [
    block('w12-d1-course-1', 1, 480, 600, '高数课', 'course'),
    block('w12-d1-study-1', 1, 840, 930, '复习四六级', 'study'),
    block('w12-d2-course-2', 2, 480, 600, '英语课', 'course'),
    // 周三排到 23:50（就寝 23:00 + 15 分钟宽限之外 → 冲突）
    block('w12-d3-activity-1', 3, 1380, 1430, '深夜赶工', 'activity'),
    block('w12-d3-meal-1', 3, 720, 750, '午餐', 'meal'),
    block('w12-d4-activity-2', 4, 480, 540, '晨跑', 'activity'),
    // 周五早于起床（wake 07:00）排事
    block('w12-d5-activity-3', 5, 380, 420, '晨跑', 'activity'),
    block('w12-d6-activity-4', 6, 600, 660, '打球', 'activity'),
  ],
} as unknown as Parameters<typeof digestPlan>[0];

/* ---------------- H3 · 作息接线 ---------------- */

test('H3: 作息已设置 → 就寝/起床冲突天数可信且算得对（RV-H3 锚）', () => {
  const d = digestBlocks(PLAN.blocks, 12, { routine: { wakeMin: 7 * 60, sleepMin: 23 * 60 } });
  assert.equal(d.bedtimeConflictDays.confident, true);
  // 周三 1380–1430（23:00–23:50）超出 23:15 宽限 → 1 天冲突
  assert.equal(d.bedtimeConflictDays.value, 1, `实际 ${d.bedtimeConflictDays.value}`);
  assert.ok(d.bedtimeConflictDays.evidence.includes('w12-d3-activity-1'), 'evidence 指到具体块');
  // 周五 06:20（380）早于 wake 07:00 → 1 天
  assert.equal(d.preWakeConflictDays.value, 1);
});

test('H3: 作息未设置 → unknown + 指引文案（绝不冒充 0）', () => {
  const d = digestBlocks(PLAN.blocks, 12, {});
  assert.equal(d.bedtimeConflictDays.confident, false);
  assert.match(d.bedtimeConflictDays.reason ?? '', /我的作息/);
  // 旧调用形态（无 ctx）行为一致
  const d2 = digestPlan(PLAN);
  assert.equal(d2.bedtimeConflictDays.confident, false);
});

test('H3: planEval 睡眠维度 —— 冲突出 gap、一致出 good、未设置出 unknown', () => {
  const withRoutine = evaluateDigest(digestBlocks(PLAN.blocks, 12, { routine: { wakeMin: 7 * 60, sleepMin: 23 * 60 } }));
  const sleep = withRoutine.dimensions.find((x) => x.key === 'sleep')!;
  const conflict = sleep.findings.find((f) => f.id === 'sleep-bedtime-conflict');
  assert.ok(conflict, '就寝冲突 finding 在位');
  assert.equal(conflict!.status, 'gap');
  assert.match(conflict!.headline, /排到.*就寝时间之后/);

  const good = evaluateDigest(digestBlocks(
    [block('a', 1, 480, 600, '课', 'course'), block('b', 2, 480, 600, '课', 'course')],
    12, { routine: { wakeMin: 7 * 60, sleepMin: 23 * 60 } },
  ));
  const ok = good.dimensions.find((x) => x.key === 'sleep')!.findings.find((f) => f.id === 'sleep-bedtime-ok');
  assert.ok(ok && ok.status === 'good', '无冲突 → good');

  const noRoutine = evaluateDigest(digestBlocks(PLAN.blocks, 12));
  const unk = noRoutine.dimensions.find((x) => x.key === 'sleep')!.findings.find((f) => f.id === 'sleep-bedtime-unknown');
  assert.ok(unk && unk.status === 'unknown' && (unk.notVisible ?? '').includes('我的作息'), '未设置 → unknown + 指引');
});

/* ---------------- H4 · 成长维度 ---------------- */

test('H4: 习惯覆盖 —— 学期占比 ≥0.8 good / <0.5 gap（RV-H4a 锚的一部分）', () => {
  const good = evaluateDigest(digestBlocks([], 12, {
    habitSpans: [{ title: '晨跑', weeks: Array.from({ length: 16 }, (_, i) => i + 1) }],
    totalWeeks: 20,
  }));
  const f = good.dimensions.find((x) => x.key === 'growth')!.findings.find((x) => x.id === 'growth-habit-晨跑');
  assert.ok(f && f.status === 'good');
  assert.match(f!.headline, /80%/);

  const gap = evaluateDigest(digestBlocks([], 12, {
    habitSpans: [{ title: '晨跑', weeks: [6, 7, 8, 9, 10, 11] }],
    totalWeeks: 20,
  }));
  const f2 = gap.dimensions.find((x) => x.key === 'growth')!.findings.find((x) => x.id === 'growth-habit-晨跑');
  assert.ok(f2 && f2.status === 'gap');
  assert.match(f2!.headline, /30%/);
  assert.ok(f2!.advice.length > 0, '低覆盖给补齐建议');
});

test('H4: 目标进度 —— 临期无相关块 gap（serious）/有相关块 good/无目标 unknown', () => {
  const urgent = evaluateDigest(digestBlocks(PLAN.blocks, 12, {
    goals: [{ title: '四六级', weeksLeft: 2 }],
  }));
  const f = urgent.dimensions.find((x) => x.key === 'growth')!.findings.find((x) => x.id === 'growth-goal-四六级');
  // PLAN 里有「复习四六级」块（标题互相包含）→ relatedBlocks ≥1 → good 而不是 gap
  assert.ok(f && f.status === 'good', `相关块匹配到「复习四六级」→ good，实际 ${f?.headline}`);

  const urgent2 = evaluateDigest(digestBlocks(PLAN.blocks, 12, {
    goals: [{ title: '数模国赛', weeksLeft: 2 }],
  }));
  const f2 = urgent2.dimensions.find((x) => x.key === 'growth')!.findings.find((x) => x.id === 'growth-goal-数模国赛');
  assert.ok(f2 && f2.status === 'gap' && f2.severity === 'serious', '临期无相关块 → serious');
  assert.ok(f2!.advice[0].includes('数模国赛'), '建议可执行（点名目标）');
});

test('H4: evaluateDigest 注册成长维度；全空 → unknown 且不冒充 0（RV-H4a 锚）', () => {
  const ev = evaluateDigest(digestBlocks([], 12, {}));
  const growth = ev.dimensions.find((x) => x.key === 'growth');
  assert.ok(growth, '成长维度在位（RV-H4a：删注册 → 红）');
  assert.equal(growth!.label, '成长');
  const unknowns = growth!.findings.filter((f) => f.status === 'unknown');
  assert.ok(unknowns.length >= 2, '无数据 → 双 unknown（习惯 + 目标）');
  assert.ok(growth!.findings.every((f) => f.status !== 'gap'), '没有数据绝不出 gap');
});

/* ---------------- 源码锁（WeekPlanView 接线） ---------------- */

test('H3/H4 源码锁: WeekPlanView 把作息/目标喂进摘要（RV-H4b 锚）', () => {
  const wv = src('/src/features/week/WeekPlanView.tsx');
  assert.match(wv, /digestPlan\(plan \?\? EMPTY_PLAN, evalCtx\)/, 'digestPlan 带 ctx（删 ctx → 红）');
  assert.match(wv, /r\.wakeMin != null && r\.sleepMin != null/, '作息真源接线（H3）');
  assert.match(wv, /goals\s*\n?\s*\.filter\(\(g\) => \(g\.status \?\? 'active'\) === 'active'/, 'GoalsPage active 目标接线（H4）');
  // 移植适配（2026-10-06 收官批次 P0-1a，已在 commit/台账申报）：上游断言
  // `/t\.recurring/` 锁的是 R5.2 recurring 重复任务跨度接线，该特性的生产端
  // （weekPlanForChat recurring: true）不在 beta-v2。本树改为**负向锁**：
  // 不许伪造习惯跨度 —— digest 未传 habitSpans = unknown（诚实标注纪律），
  // 而不是拿 weeks 数组冒充 recurring 数据。
  assert.doesNotMatch(wv, /habitSpans\s*:/, 'R5.2 不在本树：不得伪造习惯跨度（unknown 而非 0）');
  assert.match(wv, /weeksLeft: due != null \? Math\.max\(0, due - cur\) : null/, 'weeksLeft 在调用方折算（摘要层不读时钟）');
});

test('H2 源码锁: 后端复核通道三段在位（端点 / 客户端 / 面板渲染）', () => {
  const pr = src('/server/plan_review.py');
  assert.ok(pr.includes('@router.post("/api/plan/review")'), '端点在位');
  assert.ok(pr.includes('retrieved'), 'source 带 retrieved 标记（真检索 vs 静态降级）');

  const api = src('/src/lib/api.ts');
  assert.match(api, /export function planReview/, 'api.planReview 客户端');

  const wv = src('/src/features/week/WeekPlanView.tsx');
  assert.match(wv, /planReview\(\{ user_id: getUserId\(\), week_no: weekNo/, '面板展开时拉取后端复核');
  assert.match(wv, /\.catch\(\(\) => \{ if \(alive\) setEvalReview\(\{ state: 'offline' \}\); \}\)/, '失败静默降级');

  const panel = src('/src/features/week/PlanEvalPanel.tsx');
  assert.match(panel, /data-testid="plan-review-backend"/, '后端复核渲染区');
  assert.match(panel, /data-testid="plan-review-offline"/, '离线如实说明');
  assert.match(panel, /（静态口径）/, '静态降级不冒充真检索');

  // 采纳（验收补齐 2026-10-03）：建议可执行 —— 按钮 → onAdopt → 周计划攒改动流
  assert.match(panel, /data-testid="plan-review-adopt"/, '采纳按钮（RV：删按钮 → 红）');
  assert.match(panel, /a\.action\?\.kind === 'add_task' && \(/, '只有可加块表达的建议出采纳');
  assert.match(panel, /onClick=\{\(\) => onAdopt\(a\.action!\.task\)\}/, '点击交回任务骨架');
  const wv2 = src('/src/features/week/WeekPlanView.tsx');
  assert.match(wv2, /onAdopt=\{\(skeleton\) => \{/, 'WeekPlanView 接线采纳');
  assert.match(wv2, /note: '采纳自日程评估（重排后生效）'/, '任务 note 如实标注来源');
  assert.match(wv2, /handleAddTask\(\{/, '复用「加一件事」同一条攒改动流（L4：重排才生效）');
  const api2 = src('/src/lib/api.ts');
  assert.match(api2, /action\?\: \{ kind: 'add_task'; task: Record<string, unknown> \} \| null/, 'advice action 类型');
});
