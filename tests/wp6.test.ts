/**
 * WP6 —— 三餐自动就近食堂（mealAutoPlace）+ 删「常去食堂」
 * ============================================================
 * 规则（CY 拍板）：排程引擎自动参照**离下一节课上课地点最近**的食堂；
 * 候选池来自模块库 MEALS（按校区），距离走注入的 transfer provider（无 lat/lon）。
 * opt-in：`PlanRequest.mealAutoPlace` 缺省 = T2 行为（golden 语料零漂移）。
 *
 * ⚠️ 反向验证纪律（记录见 docs/wp-ledger-v2.md §WP6）：
 *   RV-1 ← construct 里拆掉 auto 分支 → 「自动填 place」用例红
 *   RV-2 ← pickCanteen 的最近比较还原成取第一个 → 「就近」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct, pickCanteen } from '@/lib/planner/construct';
import { toPlanRequest } from '@/lib/planner/schedule';
import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';
import type { TransferProvider } from '@/lib/planner/campusLookup';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');

/* ---------------- 一、自动就近（mealAutoPlace） ---------------- */

test('WP6: mealAutoPlace → 三餐 place 被自动填上（主导校区的食堂）', () => {
  // 反向：construct 里拆掉 auto 分支 → 本用例红
  const req = { ...toPlanRequest(buildGoldenInput(G)), mealAutoPlace: true };
  const { plan } = construct(req);
  const meals = plan.blocks.filter((b) => b.kind === 'meal');
  assert.ok(meals.length >= 3, `应当有三餐，实际 ${meals.length}`);
  for (const m of meals) {
    assert.ok(m.place, `${m.title} 应该有自动填的食堂`);
    assert.ok(
      ['第一食堂', '第二食堂', '第五食堂', '咪昵餐厅'].includes(m.place!),
      `${m.title} 的食堂「${m.place}」应是北校候选（语料主导校区为北校）`,
    );
  }
});

test('WP6: 不开 mealAutoPlace → place 保持空（T2/golden 行为不变）', () => {
  const { plan } = construct(toPlanRequest(buildGoldenInput(G)));
  const meals = plan.blocks.filter((b) => b.kind === 'meal');
  assert.ok(meals.length >= 3);
  for (const m of meals) assert.equal(m.place, undefined, '默认路径不填地点（golden 零漂移）');
});

/* ---------------- 二、pickCanteen 纯函数：最近者胜出 ---------------- */

test('WP6: pickCanteen 挑「到下一节课教学楼步行分钟最少」的食堂', () => {
  // 反向：最近比较还原成「取第一个候选」→ 本用例红
  const stubTransfer: TransferProvider = (from, to) => {
    if (to !== '第三教学楼') return null;
    return { minutes: from === '第五食堂' ? 3 : 25, source: 'osm', reliable: true } as never;
  };
  const pick = pickCanteen({
    mealNominalMin: 11 * 60 + 55,
    daySlots: [
      // 午饭之后的下一节课：13:00 在第三教学楼
      { course: { id: 'c1', name: '高等数学', building: '第三教学楼' }, slot: {} as never, dayOfWeek: 2, startMin: 780, endMin: 870, periodLabel: '1-2节' },
    ],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: stubTransfer,
  });
  assert.ok(pick, '北校应有候选');
  assert.equal(pick!.name, '第五食堂', '到三教 3 分钟的第五食堂应胜出（其余 25 分钟）');
  assert.equal(pick!.nextCourseTitle, '高等数学');
});

test('WP6: 饭后没课 → 取 priority 最高的候选（北校 = 第一食堂），确定性', () => {
  const a = pickCanteen({
    mealNominalMin: 18 * 60 + 30,
    daySlots: [],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: () => null,
  });
  const b = pickCanteen({
    mealNominalMin: 18 * 60 + 30,
    daySlots: [],
    campusId: 'JG516',
    templates: DEFAULT_TEMPLATES,
    transfer: () => null,
  });
  assert.ok(a && b);
  assert.equal(a.name, b.name, '同一输入必得同一食堂（确定性纪律）');
  assert.equal(a.name, '第一食堂', '无下一节课 → priority 最高的北校候选');
});

/* ---------------- 三、显式指定仍然最优先（S4 兼容） ---------------- */

test('WP6: 显式 mealPlaces 优先于自动就近（S4 语义不回退）', () => {
  const req = {
    ...toPlanRequest(buildGoldenInput(G)),
    mealAutoPlace: true,
    mealPlaces: { lunch: '咪昵餐厅' },
  };
  const { plan } = construct(req);
  const lunch = plan.blocks.find((b) => b.kind === 'meal' && b.title === '午餐');
  assert.ok(lunch, '午餐应存在');
  assert.equal(lunch!.place, '咪昵餐厅', '显式指定优先');
});
