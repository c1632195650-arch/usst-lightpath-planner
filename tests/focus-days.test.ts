/**
 * W6-A（2026-10-08，CY 拍板「A 硬约束」）· FOCUS DAYS 硬约束引擎用例
 * ============================================================
 * 语义（MOSS 验收清单 §2.2，逐条对）：
 *   S1  `undefined` 与 `[]` 都 = 无约束（与旧行为逐块一致 —— 防「清空选中 → 空周」）；
 *   S2  非空选中集 → 未选中天**不排可安排的学习/任务块**（自习/活动/浮动任务/
 *       浮动提交项/自由格）；**课程、三餐、用户钉死的固定块不得被误滤**；
 *   S3  引擎只吃 `activeDays`(1-7)，ISO→星期映射在调用方（App）；
 *   S4  消费点在 `BuildWeekPlanInput`，planner 不反向依赖 memo/UI 层；
 *   S5  契约字段增删在 commit message + BLOCKERS 显式申报。
 *
 * ⚠️ 反向验证（reversed-verified，验收清单 §2.3-3）：
 *   · 变异体①「空数组也算约束」→ S1 用例红（golden 同理红）；
 *   · 变异体②摘掉 construct 的按天门控 → S2 用例红。
 *   实测红记录见 commit message。
 *
 * golden 零漂移前提：语料（tests/golden/week-*.json）不带 activeDays →
 * 默认路径 activeDaySet=null → 所有门控恒开 → 逐字节一致（golden-lib 全绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekPlan, type BuildWeekPlanInput } from '@/lib/planner/schedule.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';

/** 软块 = 「可安排的学习/任务块」：W6-A 硬约束要清掉的对象 */
const SOFT_KINDS = new Set(['study', 'activity', 'user', 'blank']);

const base: BuildWeekPlanInput = buildGoldenInput(GOLDEN_INPUTS[0]);

test('W6-A·S1：activeDays 缺省与空数组 = 无约束，两者逐块一致（防「清空 → 空周」）', () => {
  const without = buildWeekPlan({ ...base });
  const withEmpty = buildWeekPlan({ ...base, activeDays: [] });
  assert.deepEqual(
    withEmpty.plan.blocks.map((b) => b.id),
    without.plan.blocks.map((b) => b.id),
    '空数组必须与不传逐块一致',
  );
  assert.deepEqual(withEmpty.plan.stats, without.plan.stats);
});

test('W6-A·S2：只选周三 → 其余天无非课程软块；有课天的课程块保留', () => {
  const r = buildWeekPlan({ ...base, activeDays: [3] });
  const byDay = new Map<number, typeof r.plan.blocks>();
  for (const b of r.plan.blocks) {
    byDay.set(b.dayOfWeek, [...(byDay.get(b.dayOfWeek) ?? []), b]);
  }
  // 未选中的天：不允许出现任何软块（study/activity/user/blank）
  for (const day of [1, 2, 4, 5, 6, 7]) {
    const soft = (byDay.get(day) ?? []).filter((b) => SOFT_KINDS.has(b.kind));
    assert.deepEqual(soft.map((b) => b.id), [], `周${day} 不该有可安排软块，实际 ${soft.length} 个`);
  }
  // 选中天（周三）：自习真的排上了（golden 夹具第 4 周整周有自习预算）
  const wedStudy = (byDay.get(3) ?? []).filter((b) => b.kind === 'study');
  assert.ok(wedStudy.length > 0, '选中天必须真的排上自习（否则是假约束）');

  // S2 右半句：有课的天（周一 c1/c2、周四 c4）课程块必须保留
  const monCourses = (byDay.get(1) ?? []).filter((b) => b.kind === 'course');
  const thuCourses = (byDay.get(4) ?? []).filter((b) => b.kind === 'course');
  assert.ok(monCourses.length > 0, '未选中天的课程块不得被误滤（周一）');
  assert.ok(thuCourses.length > 0, '未选中天的课程块不得被误滤（周四）');
  // 三餐保留（生理锚点）：周一只留课程+三餐+转场，不允许被清成空天
  const monMeals = (byDay.get(1) ?? []).filter((b) => b.kind === 'meal');
  assert.ok(monMeals.length > 0, '未选中天的三餐不得被误滤（周一）');
});

test('W6-A·S2：用户钉死的固定块等同既成事实 —— 未选中天不裁', () => {
  const fixedTask = {
    id: 'ut-fixed-mon', title: '用户钉死的固定块', emoji: '📌', kind: 'activity' as const,
    durationMin: 60, dayOfWeek: 1 as const, startMin: 19 * 60, weeks: [4], priority: 95,
  };
  const r = buildWeekPlan({ ...base, activeDays: [3], tasks: [...(base.tasks ?? []), fixedTask] });
  const kept = r.plan.blocks.filter((b) => b.id.endsWith('-ut-fixed-mon'));
  assert.equal(kept.length, 1, '用户显式落点（固定块）在未选中天必须保留');
  assert.equal(kept[0].dayOfWeek, 1);
});

test('W6-A·诚实纪律：约束生效时 notes 必须说明哪几天没排', () => {
  const r = buildWeekPlan({ ...base, activeDays: [3] });
  const note = r.notes.find((n) => n.includes('没有排自习与任务'));
  assert.ok(note, `notes 里必须有诚实说明，实际 notes=${JSON.stringify(r.notes)}`);
  assert.ok(note!.includes('周一'), '说明要点名未选中的天');
  // 不生效时不出现这条 note
  const r2 = buildWeekPlan({ ...base });
  assert.ok(!r2.notes.some((n) => n.includes('没有排自习与任务')), '无约束时不得出现该 note');
});
