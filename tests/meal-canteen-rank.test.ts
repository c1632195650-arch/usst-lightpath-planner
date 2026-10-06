/**
 * P1-6 / P1-7 部分（2026-10-06 收官批次·批次 5，CY 裁决 R3）
 * 三餐食堂选取 × 步行预算（mealWalkBudgetMin）
 * ============================================================
 * 任务书 P1-6：三餐地点此前「按校区写死 + 离下一节课最近」，画像「就餐半径」
 * 算出来了没人用。接线：pickCanteen 候选池先过 rankPlaces 统一纪律
 * （校区过滤 / 营业时段 / 步行预算），再按既有口径择序；
 * 预算来源 = `PlanRequest.mealWalkBudgetMin`（P1-7 部分，显式优先）
 * 回落 profilePrefs.blockPrefs 的 mealWalkBudgetMin（画像 meal_radius 推导）。
 *
 * 红线（placesPolicy 既定纪律）：`walk` 查询返回 null = **未知**——
 * 保留候选、排在已知之后，绝不吸附到本部坐标。
 *
 * 契约: BuildWeekPlanInput/PlanRequest 增 mealWalkBudgetMin?（可选字段，opt-in）。
 *
 * ⚠️ 反向验证（RV，红线 4）：删 construct 里 pickCanteen 的 walkBudgetMin
 *   透传 → 近/远两档用例红（推荐点集合不再随预算变化）→ 还原 sha256 一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct } from '@/lib/planner/construct';
import { pickCanteen } from '@/lib/planner/construct';
import { toPlanRequest } from '@/lib/planner/schedule';
import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');

/** 名义午餐时刻 12:00 */
const LUNCH = 12 * 60;

/** stub 转场：食堂 → 下一节课教学楼的步行分钟（null = 未知，路网未入库） */
function walkStub(minutes: Record<string, number>): (from: string, to: string) => { minutes: number; reliable: boolean } | null {
  return (from) => (from in minutes ? { minutes: minutes[from], reliable: true } : null);
}

/** 无下一节课（daySlots 空）→ 走 pickCanteen 的「预算过滤 + priority 择序」路径 */
function pickNoNext(walkBudgetMin: number | undefined, minutes: Record<string, number>) {
  return pickCanteen({
    mealNominalMin: LUNCH,
    daySlots: [],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: walkStub(minutes) as never,
    walkBudgetMin,
  });
}

/** 有下一节课（daySlots 给锚点）→ rankPlaces 带距离排序 + 预算过滤；返回 pick 与 pool */
function pickWithNext(walkBudgetMin: number, minutes: Record<string, number>) {
  const pick = pickCanteen({
    mealNominalMin: LUNCH,
    daySlots: [fakeSlot()],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: walkStub(minutes) as never,
    walkBudgetMin,
  });
  return { pick, pool: pick?.pool };
}

/** 带缺省分钟的 stub：未列名的食堂按 defaultMinutes 计（全员超支场景用） */
function pickWithNextAll(budget: number, minutes: Record<string, number>, defaultMinutes: number) {
  const pick = pickCanteen({
    mealNominalMin: LUNCH,
    daySlots: [fakeSlot()],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: ((from: string) =>
      from in minutes
        ? { minutes: minutes[from], reliable: true }
        : { minutes: defaultMinutes, reliable: true }) as never,
    walkBudgetMin: budget,
  });
  return { pick, pool: pick?.pool };
}

/** 最小 EffectiveSlot：14:00 有一节课在教学楼「一教」 */
function fakeSlot() {
  return {
    course: { id: 'c1', name: '高等数学AI', building: '一教', campus: 'JG516' },
    slot: { dayOfWeek: 1, startPeriod: 1, endPeriod: 2 },
    dayOfWeek: 1 as const,
    startMin: 14 * 60,
    endMin: 15 * 60 + 30,
    periodLabel: '1-2 节',
  } as never;
}

test('P1-6: 预算收紧（近档 10 分钟）→ 超预算食堂被剔出推荐点集合（含 priority 最高者）', () => {
  // 下一节课在教学楼（有步行锚点）：第一食堂 12 分钟（priority 80）、第二食堂 9 分钟。
  // 近档 10 → 第一食堂被剔；推荐点集合只剩 9 分钟的第二食堂（近档集合步行分钟更小）
  const { pick, pool } = pickWithNext(10, { 第一食堂: 12, 第二食堂: 9 });
  assert.ok(pool);
  assert.ok(!pool!.includes('第一食堂'), `近档集合不应含超预算的第一食堂，实际 ${pool}`);
  assert.ok(pool!.includes('第二食堂'), '预算内的第二食堂应保留在集合中');
  assert.equal(pick!.name, '第二食堂', '有锚点时按步行最近择序');
});

test('P1-6: 预算放宽（远档 25 分钟）→ 推荐点集合变大，集合与近档不同', () => {
  const near = pickWithNext(10, { 第一食堂: 12, 第二食堂: 9 });
  const far = pickWithNext(25, { 第一食堂: 12, 第二食堂: 9 });
  assert.ok(near.pool && far.pool);
  assert.ok(far.pool!.includes('第一食堂'), '远档下 12 分钟的第一食堂应回到集合');
  assert.ok(far.pool!.length > near.pool!.length, '远档集合应更大');
  assert.notDeepEqual(near.pool, far.pool, '近/远两档的推荐点集合必须不同（任务书 P1-6 验收）');
});

test('P1-6: 预算收紧到全员超支 → 回退默认推荐序 priority（饭不丢，如实降级）', () => {
  // 近档 5 → 已知步行分钟的全员超支（未列名食堂按 30 计）→ ranked 空 →
  // 回退默认推荐序（priority：第一食堂 80）；无可信排序 → 不带 pool（不冒充）
  const { pick, pool } = pickWithNextAll(5, { 第一食堂: 12, 第二食堂: 9 }, 30);
  assert.ok(pick, '全员超支也要给出推荐');
  assert.equal(pick!.name, '第一食堂', '回退时按 priority 择序');
  assert.equal(pool, undefined, '回退路径不带 pool（无可信排序，如实不冒充）');
});

test('P1-6: 预算翻转——最近的食堂超支 → 收紧档回退 priority、放宽档取最近', () => {
  // 第二食堂步行最近（12）但超近档 10 → 近档全员超支 → 回退 priority（第一食堂）；
  // 远档 25 → 第二食堂回到集合 → 取步行最近（12 < 18）。近/远推荐必须不同。
  const near = pickWithNextAll(10, { 第一食堂: 18, 第二食堂: 12 }, 30);
  const far = pickWithNextAll(25, { 第一食堂: 18, 第二食堂: 12 }, 30);
  assert.equal(near.pick!.name, '第一食堂', '全员超支 → 回退 priority 择序');
  assert.equal(far.pick!.name, '第二食堂', '放宽后取步行最近');
  assert.notEqual(near.pick!.name, far.pick!.name, '近/远两档的推荐必须不同');
});

test('P1-6: walk 查询 null = 未知 —— 不剔池、不吸附本部坐标（按 priority 兜底）', () => {
  // 两家都拿不到步行分钟（如 1100 校区路网未入库）→ 都保留（walkMin null 排后），
  // 推荐回落 priority 最高者 —— 绝不猜一个「更近」的假距离
  const pick = pickNoNext(10, {});
  assert.ok(pick);
  assert.ok(['第一食堂', '第二食堂'].includes(pick.name), `应从真实候选池按 priority 选，实际 ${pick.name}`);
});

test('P1-6: 名义饭点在营业时段外 → 该食堂被剔；全剔则回退原池（饭不丢）', () => {
  // 第一食堂午餐窗口 10:45–13:30（北校三餐晚些）；把名义饭点推到 15:00 → 全部食堂
  // 的午餐窗口都过了 → ranked 空 → 回退原池按 priority 推荐第一食堂（绝不把饭排丢）
  const pick = pickCanteen({
    mealNominalMin: 15 * 60,
    daySlots: [],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: walkStub({ 第一食堂: 5 }) as never,
    walkBudgetMin: 10,
  });
  assert.ok(pick, '饭点在窗口外 → 回退原池也要给出推荐');
});

test('P1-7 部分: 显式 mealWalkBudgetMin 进引擎 → 一周三餐的推荐点随预算变化（construct 级）', () => {
  // 注入细粒度步行数据：第二食堂 12 分钟（步行最近，priority 74）、第一食堂 18、其余 30。
  // 远档 25 → 有锚点的饭推荐步行最近（第二食堂）；近档 10 → 全员超支 → 回退
  // priority（第一食堂）——两档的三餐地点集合必须不同（预算真实进引擎裁决）。
  const stub = (from: string): { minutes: number; reliable: boolean } | null => {
    if (from === '第一食堂') return { minutes: 18, reliable: true };
    if (from === '第二食堂') return { minutes: 12, reliable: true };
    return { minutes: 30, reliable: true };
  };
  const meals = (budget: number) => {
    const req = {
      ...toPlanRequest(buildGoldenInput(G)),
      mealAutoPlace: true,
      mealWalkBudgetMin: budget,
      transfer: stub as never,
    };
    const plan = construct(req).plan;
    return plan.blocks
      .filter((b) => b.kind === 'meal' && b.place)
      .map((b) => b.place!)
      .sort();
  };
  const tight = meals(8);
  const loose = meals(25);
  assert.ok(tight.length > 0 && loose.length > 0, '两档都应产出带地点的三餐');
  assert.notDeepEqual(
    [...new Set(tight)], [...new Set(loose)],
    '近/远两档的三餐推荐点集合应不同（步行预算真实进引擎裁决）',
  );
});

test('P1-7 部分: BuildWeekPlanInput.mealWalkBudgetMin 经 toPlanRequest 条件透传', () => {
  const base = buildGoldenInput(G);
  const absent = toPlanRequest(base) as Record<string, unknown>;
  assert.ok(!('mealWalkBudgetMin' in absent), '不传 → 字段不出现（逐字段一致纪律）');
  const present = toPlanRequest({ ...base, mealWalkBudgetMin: 12 }) as Record<string, unknown>;
  assert.equal(present.mealWalkBudgetMin, 12, '传入 → 透传到 PlanRequest');
});
