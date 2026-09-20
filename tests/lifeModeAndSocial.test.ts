/**
 * 阶段 D 测试：生活模式真正生效 + 社交类模板
 * ============================================================
 * 覆盖两个「此前是装饰」的地方：
 *   1. `lifeMode` —— 之前只换配色文案，现在必须真正改变强度；
 *   2. 社交类活动 —— 之前画像里四个社交数据全闲置，现在至少要有落点。
 *
 * 零依赖：node:test + register.mjs 的 `@/` 钩子。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyLifeMode, lifeModeFactorOf } from '@/lib/planner/lifeModePolicy';
import { buildPhases } from '@/lib/planner/buildPhases';
import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');
const schedule = buildGoldenInput(G).schedule;

function policy() {
  return {
    dailyStudyMin: 120, maxBlockMin: 90, blankRatio: 0.25,
    eveningAllowed: false, weekendWork: false, studyPlaces: ['图书馆'],
  };
}

/* ============================================================
 * 一、applyLifeMode
 * ========================================================== */

test('lifeMode: 猛攻模式上调目标时长', () => {
  const r = applyLifeMode(policy(), 'grind');
  assert.equal(r.policy.dailyStudyMin, Math.round(120 * 1.3));
  assert.ok(r.note && r.note.includes('猛攻'), `应当留下说明，实际：${r.note}`);
});

test('lifeMode: 摸鱼模式下调目标时长并增加留白', () => {
  const base = policy();
  const r = applyLifeMode(base, 'slack');
  assert.ok(r.policy.dailyStudyMin < base.dailyStudyMin, '目标应当变低');
  assert.ok(r.policy.blankRatio > base.blankRatio, '留白应当变多');
});

test('lifeMode: 平衡模式是基准（乘数 1，不改数值）', () => {
  const base = policy();
  const r = applyLifeMode(base, 'balance');
  assert.equal(r.policy.dailyStudyMin, base.dailyStudyMin);
  assert.equal(r.policy.blankRatio, base.blankRatio);
});

test('lifeMode: 未识别的 id → 原样返回且不编说明（不猜）', () => {
  const base = policy();
  const r = applyLifeMode(base, '不存在的模式');
  assert.deepEqual(r.policy, base);
  assert.equal(r.note, null);
  assert.equal(lifeModeFactorOf('不存在的模式'), null);
});

test('lifeMode: null / undefined → 原样返回', () => {
  const base = policy();
  assert.deepEqual(applyLifeMode(base, null).policy, base);
  assert.deepEqual(applyLifeMode(base, undefined).policy, base);
});

test('lifeMode: 留白比例被夹在同一套边界内（不越界）', () => {
  // 连续叠加多个高留白模式也不该冲破上限
  let p = policy();
  for (let i = 0; i < 10; i += 1) p = applyLifeMode(p, 'slack').policy;
  assert.ok(p.blankRatio <= 0.6, `留白不该超过 0.6，实际 ${p.blankRatio}`);
  assert.ok(p.blankRatio >= 0.1, `留白不该低于 0.1，实际 ${p.blankRatio}`);
});

test('lifeMode: 目标时长不为负', () => {
  const p = applyLifeMode({ ...policy(), dailyStudyMin: 0 }, 'slack').policy;
  assert.ok(p.dailyStudyMin >= 0);
});

test('lifeMode: 不修改传入的策略对象', () => {
  const base = policy();
  const snapshot = { ...base };
  applyLifeMode(base, 'grind');
  assert.deepEqual(base, snapshot, 'base 不该被改动（纯函数纪律）');
});

/* ============================================================
 * 二、buildPhases 接入生活模式
 * ========================================================== */

test('buildPhases: 不传 lifeMode → 与原来逐字段一致（零改动保证）', () => {
  const a = buildPhases(schedule, null, {});
  const b = buildPhases(schedule, null, {}, null, null);
  assert.deepEqual(a.plan, b.plan);
});

test('buildPhases: 传猛攻模式 → 各阶段目标时长上调，且在理由里说明', () => {
  const base = buildPhases(schedule, null, {});
  const grind = buildPhases(schedule, null, {}, null, 'grind');
  for (let i = 0; i < base.plan.phases.length; i += 1) {
    const b = base.plan.phases[i];
    const g = grind.plan.phases[i];
    assert.equal(g.policy.dailyStudyMin, Math.round(b.policy.dailyStudyMin * 1.3),
      `阶段「${b.name}」应上调三成`);
    assert.ok(g.reasons.some((x) => x.includes('猛攻')),
      `理由里应当出现模式说明，实际：${JSON.stringify(g.reasons)}`);
  }
});

test('buildPhases: 切换模式确实产出不同结果（不是只换皮）', () => {
  const slack = buildPhases(schedule, null, {}, null, 'slack');
  const grind = buildPhases(schedule, null, {}, null, 'grind');
  assert.notEqual(
    slack.plan.phases[0].policy.dailyStudyMin,
    grind.plan.phases[0].policy.dailyStudyMin,
    '「摸鱼」与「猛攻」必须排出不同强度 —— 否则这个开关就是假的',
  );
});

test('buildPhases: 校正层在生活模式之后生效（顺序保证）', () => {
  // 先 ×0.6（摸鱼）再 +60（校正）→ 120×0.6+60 = 132
  const r = buildPhases(schedule, null, {}, [{
    id: 'c1', kind: 'target_duration',
    payload: { kind: 'target_duration', deltaMinPerDay: 60, scope: 'study' },
    active: true, source: 'ui', createdAt: '', mapsTo: 'policy',
  }], 'slack');
  const b = buildPhases(schedule, null, {}, null, 'slack');
  for (let i = 0; i < b.plan.phases.length; i += 1) {
    assert.equal(
      r.plan.phases[i].policy.dailyStudyMin,
      b.plan.phases[i].policy.dailyStudyMin + 60,
      '校正应当在模式调整之后叠加（用户明确说的话最后生效）',
    );
  }
});

/* ============================================================
 * 三、社交类模板（补画像里被闲置的社交数据）
 * ========================================================== */

test('模板: 已有社交类模板，且不再是一个都不缺', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.length >= 2, `应当有至少 2 个社交类模板，实际 ${social.length}`);
});

test('模板: 社交模板受画像触发约束（不是无条件排）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  for (const t of social) {
    assert.ok(t.trigger, `社交模板「${t.name}」应当挂 trigger，否则会对所有用户都排`);
    assert.ok(
      ['social_radius', 'event_breadth'].includes(String(t.trigger.field)),
      `社交模板「${t.name}」的 trigger 应当来自社交相关字段，实际 ${String(t.trigger?.field)}`,
    );
  }
});

test('模板: 社交是独立类别（不与「取快递/夜宵」抢每日名额）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.every((t) => t.category !== 'life'),
    '若与 life 同类，社交名额会被取快递/夜宵挤掉');
});

test('模板: 社交模板默认参与自动排程（autoPlace 不为 false）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.every((t) => t.autoPlace !== false),
    '社交块应能被引擎自动排入，否则用户仍然看不到社交时间');
});
